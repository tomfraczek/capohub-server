import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { GlobalRole } from '../src/auth/permissions/global-role.enum';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { closeE2eApp } from './close-e2e-app.helper';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { User } from '../src/users/entities/user.entity';
import { InstrumentDetailsResponseDto } from '../src/instruments/dto/instrument-details-response.dto';
import { InstrumentListItemResponseDto } from '../src/instruments/dto/instrument-list-item-response.dto';
import { Instrument } from '../src/instruments/entities/instrument.entity';
import { InstrumentRhythm } from '../src/rhythms/entities/instrument-rhythm.entity';
import { Rhythm } from '../src/rhythms/entities/rhythm.entity';

const USER_TOKEN = 'valid-instruments-user-token';
const ADMIN_TOKEN = 'valid-instruments-admin-token';
const USER_CLERK_ID = 'user_test_instruments_user';
const ADMIN_CLERK_ID = 'user_test_instruments_admin';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [USER_TOKEN]: {
    userId: USER_CLERK_ID,
    sessionId: 'sess_instruments_user',
    tokenType: 'session_token',
    claims: { sub: USER_CLERK_ID, sid: 'sess_instruments_user' },
  },
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_instruments_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_instruments_admin' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [USER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/instruments-user.png',
    primaryEmailAddress: { emailAddress: 'instruments.user@example.com' },
  },
  [ADMIN_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/instruments-admin.png',
    primaryEmailAddress: { emailAddress: 'instruments.admin@example.com' },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) {
      return Promise.resolve(auth);
    }
    return Promise.reject(new UnauthorizedException('Authentication required'));
  },
};

const fixtureClerkClient = {
  users: {
    getUser: (clerkUserId: string) => {
      const profile = FIXTURE_CLERK_PROFILES[clerkUserId];
      if (!profile) {
        return Promise.reject(
          new Error(`Unknown test Clerk user ${clerkUserId}`),
        );
      }
      return Promise.resolve({ id: clerkUserId, ...profile });
    },
    deleteUser: () => Promise.resolve(),
  },
};

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Instruments (e2e)', () => {
  let app: INestApplication<App>;
  const createdInstrumentIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
      .compile();

    app = moduleFixture.createNestApplication();
    const appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Instrument, {
        id: { $in: createdInstrumentIds },
      });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  // Grants MUSIC_CONTENT_MANAGE by setting globalRole directly through the
  // EntityManager fixture, never through a public endpoint (there is none).
  // The first authenticated request creates the local User row.
  async function grantAdmin(token: string): Promise<void> {
    await request(app.getHttpServer())
      .get('/api/v1/instruments')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const em = app.get(EntityManager).fork();
    const auth = TOKEN_TO_AUTH[token];
    const user = await em.findOneOrFail(User, { clerkUserId: auth.userId });
    user.globalRole = GlobalRole.ADMIN;
    await em.flush();
  }

  function instrumentPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const suffix = randomUUID().slice(0, 8);
    return {
      name: `Test Berimbau ${suffix}`,
      alternativeNames: ['Berimbau de barriga'],
      shortDescription: 'The lead instrument of the bateria',
      description: 'Full description',
      history: 'History',
      construction: 'Construction',
      howToPlay: 'How to play',
      roleInBateria: 'Leads the roda',
      displayOrder: 1,
      isActive: true,
      media: [],
      ...overrides,
    };
  }

  async function createInstrument(
    payload: Record<string, unknown>,
  ): Promise<InstrumentDetailsResponseDto> {
    const created = await bodyOf<InstrumentDetailsResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/admin/instruments')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send(payload)
        .expect(201),
    );
    createdInstrumentIds.push(created.id);
    return created;
  }

  beforeAll(async () => {
    await grantAdmin(ADMIN_TOKEN);
  });

  describe('admin CRUD', () => {
    it('creates an instrument, deriving the slug from the name', async () => {
      const created = await createInstrument(
        instrumentPayload({ name: 'Agogô Test' }),
      );

      expect(created.slug).toContain('agogo-test');
      expect(created.alternativeNames).toEqual(['Berimbau de barriga']);
      expect(created.isActive).toBe(true);
      expect(created.media).toEqual([]);
      expect(created.rhythms).toEqual([]);
    });

    it('fetches, updates and deactivates an instrument', async () => {
      const created = await createInstrument(instrumentPayload());

      const fetched = await bodyOf<InstrumentDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/admin/instruments/${created.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      expect(fetched).toEqual(created);

      const updated = await bodyOf<InstrumentDetailsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/instruments/${created.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(
            instrumentPayload({
              name: created.name,
              slug: created.slug,
              isActive: false,
            }),
          )
          .expect(200),
      );
      expect(updated.isActive).toBe(false);
      expect(updated.slug).toBe(created.slug);
    });

    it('replaces media wholesale on update', async () => {
      const created = await createInstrument(
        instrumentPayload({
          media: [
            {
              type: 'IMAGE',
              url: 'https://example.com/a.jpg',
              title: 'A',
              description: null,
              displayOrder: 1,
            },
          ],
        }),
      );
      expect(created.media).toHaveLength(1);

      const updated = await bodyOf<InstrumentDetailsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/instruments/${created.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(
            instrumentPayload({
              name: created.name,
              slug: created.slug,
              media: [
                {
                  type: 'YOUTUBE',
                  url: 'https://www.youtube.com/watch?v=abc123',
                  title: 'Video',
                  description: null,
                  displayOrder: 1,
                },
              ],
            }),
          )
          .expect(200),
      );

      expect(updated.media).toHaveLength(1);
      expect(updated.media[0].type).toBe('YOUTUBE');
    });

    it('rejects a duplicate slug with 409 SLUG_CONFLICT', async () => {
      const created = await createInstrument(instrumentPayload());

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/admin/instruments')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(instrumentPayload({ name: 'Whatever', slug: created.slug }))
          .expect(409),
      );
      expect(response.code).toBe('SLUG_CONFLICT');
    });

    it('lists both active and inactive instruments for admin', async () => {
      const created = await createInstrument(
        instrumentPayload({ isActive: false }),
      );

      const list = await bodyOf<{ id: string; isActive: boolean }[]>(
        request(app.getHttpServer())
          .get('/api/v1/admin/instruments')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      const row = list.find((item) => item.id === created.id);
      expect(row?.isActive).toBe(false);
    });

    it('deletes an instrument with no relations', async () => {
      const created = await createInstrument(instrumentPayload());

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/instruments/${created.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/admin/instruments/${created.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(404);

      createdInstrumentIds.splice(createdInstrumentIds.indexOf(created.id), 1);
    });

    it('blocks deletion with 409 INSTRUMENT_HAS_RELATIONS when linked to a rhythm', async () => {
      const created = await createInstrument(instrumentPayload());
      const em = app.get(EntityManager).fork();
      const rhythm = new Rhythm();
      rhythm.slug = `test-rhythm-${randomUUID().slice(0, 8)}`;
      rhythm.name = 'Test Rhythm';
      rhythm.alternativeNames = [];
      await em.persistAndFlush(rhythm);

      const link = new InstrumentRhythm();
      link.instrument = em.getReference(Instrument, created.id);
      link.rhythm = rhythm;
      link.displayOrder = 1;
      await em.persistAndFlush(link);

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/admin/instruments/${created.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('INSTRUMENT_HAS_RELATIONS');

      await em.nativeDelete(InstrumentRhythm, { id: link.id });
      await em.nativeDelete(Rhythm, { id: rhythm.id });
    });

    it('rejects requests from a non-admin user with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/instruments')
        .set('Authorization', `Bearer ${USER_TOKEN}`)
        .expect(403);
    });

    it('rejects unauthenticated requests with 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/instruments')
        .expect(401);
    });
  });

  describe('public catalogue', () => {
    it('lists only active instruments, ordered by displayOrder then name', async () => {
      const first = await createInstrument(
        instrumentPayload({ name: 'AAA First', displayOrder: 1 }),
      );
      const second = await createInstrument(
        instrumentPayload({ name: 'ZZZ Second', displayOrder: 1 }),
      );
      const inactive = await createInstrument(
        instrumentPayload({ name: 'Inactive One', isActive: false }),
      );

      const list = await bodyOf<InstrumentListItemResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/instruments')
          .set('Authorization', `Bearer ${USER_TOKEN}`)
          .expect(200),
      );

      const ids = list.map((item) => item.id);
      expect(ids).not.toContain(inactive.id);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    });

    it('filters by search across name and alternativeNames', async () => {
      const suffix = randomUUID().slice(0, 8);
      const created = await createInstrument(
        instrumentPayload({
          name: `Unique Name ${suffix}`,
          alternativeNames: [`Alt Spelling ${suffix}`],
        }),
      );

      const byName = await bodyOf<InstrumentListItemResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/instruments')
          .query({ search: `Unique Name ${suffix}` })
          .set('Authorization', `Bearer ${USER_TOKEN}`)
          .expect(200),
      );
      expect(byName.map((item) => item.id)).toContain(created.id);

      const byAltName = await bodyOf<InstrumentListItemResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/instruments')
          .query({ search: `alt spelling ${suffix}` })
          .set('Authorization', `Bearer ${USER_TOKEN}`)
          .expect(200),
      );
      expect(byAltName.map((item) => item.id)).toContain(created.id);
    });

    it('returns full details, including media, for an active instrument', async () => {
      const created = await createInstrument(
        instrumentPayload({
          media: [
            {
              type: 'IMAGE',
              url: 'https://example.com/photo.jpg',
              title: 'Photo',
              description: null,
              displayOrder: 1,
            },
          ],
        }),
      );

      const details = await bodyOf<InstrumentDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/instruments/${created.slug}`)
          .set('Authorization', `Bearer ${USER_TOKEN}`)
          .expect(200),
      );

      expect(details.id).toBe(created.id);
      expect(details.media).toHaveLength(1);
      expect(details.media[0].url).toBe('https://example.com/photo.jpg');
    });

    it('includes related rhythms, ordered by displayOrder, excluding inactive ones', async () => {
      const created = await createInstrument(instrumentPayload());
      const em = app.get(EntityManager).fork();

      const activeRhythm = new Rhythm();
      activeRhythm.slug = `test-rhythm-active-${randomUUID().slice(0, 8)}`;
      activeRhythm.name = 'Active Rhythm';
      activeRhythm.alternativeNames = [];
      const inactiveRhythm = new Rhythm();
      inactiveRhythm.slug = `test-rhythm-inactive-${randomUUID().slice(0, 8)}`;
      inactiveRhythm.name = 'Inactive Rhythm';
      inactiveRhythm.alternativeNames = [];
      inactiveRhythm.isActive = false;
      await em.persistAndFlush([activeRhythm, inactiveRhythm]);

      const activeLink = new InstrumentRhythm();
      activeLink.instrument = em.getReference(Instrument, created.id);
      activeLink.rhythm = activeRhythm;
      activeLink.roleDescription = 'Marks the base rhythm';
      activeLink.displayOrder = 1;
      const inactiveLink = new InstrumentRhythm();
      inactiveLink.instrument = em.getReference(Instrument, created.id);
      inactiveLink.rhythm = inactiveRhythm;
      inactiveLink.displayOrder = 2;
      await em.persistAndFlush([activeLink, inactiveLink]);

      const details = await bodyOf<InstrumentDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/instruments/${created.slug}`)
          .set('Authorization', `Bearer ${USER_TOKEN}`)
          .expect(200),
      );

      expect(details.rhythms).toEqual([
        {
          id: activeRhythm.id,
          slug: activeRhythm.slug,
          name: activeRhythm.name,
          shortDescription: null,
          roleDescription: 'Marks the base rhythm',
          displayOrder: 1,
        },
      ]);

      await em.nativeDelete(InstrumentRhythm, {
        id: { $in: [activeLink.id, inactiveLink.id] },
      });
      await em.nativeDelete(Rhythm, {
        id: { $in: [activeRhythm.id, inactiveRhythm.id] },
      });
    });

    it('returns 404 for an inactive instrument', async () => {
      const created = await createInstrument(
        instrumentPayload({ isActive: false }),
      );

      await request(app.getHttpServer())
        .get(`/api/v1/instruments/${created.slug}`)
        .set('Authorization', `Bearer ${USER_TOKEN}`)
        .expect(404);
    });

    it('returns 404 for a non-existent slug', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/instruments/does-not-exist')
        .set('Authorization', `Bearer ${USER_TOKEN}`)
        .expect(404);
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer()).get('/api/v1/instruments').expect(401);
    });
  });
});
