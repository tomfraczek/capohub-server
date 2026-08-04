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
import { Instrument } from '../src/instruments/entities/instrument.entity';
import { RhythmDetailsResponseDto } from '../src/rhythms/dto/rhythm-details-response.dto';
import { RhythmListItemResponseDto } from '../src/rhythms/dto/rhythm-list-item-response.dto';
import { Rhythm } from '../src/rhythms/entities/rhythm.entity';
import { SongRhythm } from '../src/rhythms/entities/song-rhythm.entity';
import { SongDetailsResponseDto } from '../src/songs/dto/song-details-response.dto';
import { Song } from '../src/songs/entities/song.entity';
import { SongCategory } from '../src/songs/entities/song-category.entity';

const OWNER_TOKEN = 'valid-rhythms-owner-token';
const OTHER_TOKEN = 'valid-rhythms-other-token';
const ADMIN_TOKEN = 'valid-rhythms-admin-token';
const OWNER_CLERK_ID = 'user_test_rhythms_owner';
const OTHER_CLERK_ID = 'user_test_rhythms_other';
const ADMIN_CLERK_ID = 'user_test_rhythms_admin';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_rhythms_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_rhythms_owner' },
  },
  [OTHER_TOKEN]: {
    userId: OTHER_CLERK_ID,
    sessionId: 'sess_rhythms_other',
    tokenType: 'session_token',
    claims: { sub: OTHER_CLERK_ID, sid: 'sess_rhythms_other' },
  },
  [ADMIN_TOKEN]: {
    userId: ADMIN_CLERK_ID,
    sessionId: 'sess_rhythms_admin',
    tokenType: 'session_token',
    claims: { sub: ADMIN_CLERK_ID, sid: 'sess_rhythms_admin' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rhythms-owner.png',
    primaryEmailAddress: { emailAddress: 'rhythms.owner@example.com' },
  },
  [OTHER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rhythms-other.png',
    primaryEmailAddress: { emailAddress: 'rhythms.other@example.com' },
  },
  [ADMIN_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/rhythms-admin.png',
    primaryEmailAddress: { emailAddress: 'rhythms.admin@example.com' },
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

function minimalSongPayload(
  categoryId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const suffix = randomUUID().slice(0, 8);
  return {
    title: `Rhythm test song ${suffix}`,
    authorName: 'Mestre Test',
    categoryId,
    alternativeTitles: [],
    tagIds: [],
    parts: [
      {
        performer: 'LEAD',
        position: 1,
        lines: [
          {
            originalText: 'Some lyric line',
            phoneticText: null,
            position: 1,
            translations: [],
          },
        ],
      },
    ],
    media: [],
    meaningHistory: null,
    meaningContext: null,
    meaningTrivia: null,
    ...overrides,
  };
}

describe('Rhythms (e2e)', () => {
  let app: INestApplication<App>;
  let category: SongCategory;
  const createdSongIds: string[] = [];
  const createdRhythmIds: string[] = [];
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

    const em = app.get(EntityManager).fork();
    category = new SongCategory();
    category.code = `TEST_E2E_RH_${randomUUID().slice(0, 8)}`;
    category.name = 'Test rhythms category';
    category.position = 999;
    category.isActive = true;
    await em.persistAndFlush(category);

    await grantAdmin(ADMIN_TOKEN);
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(SongRhythm, {});
      await cleanup.nativeDelete(Song, { category: category.id });
      await cleanup.nativeDelete(SongCategory, { id: category.id });
      await cleanup.nativeDelete(Rhythm, { id: { $in: createdRhythmIds } });
      await cleanup.nativeDelete(Instrument, {
        id: { $in: createdInstrumentIds },
      });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  afterEach(async () => {
    const cleanup = app.get(EntityManager).fork();
    if (createdSongIds.length > 0) {
      await cleanup.nativeDelete(Song, { id: { $in: createdSongIds } });
      createdSongIds.length = 0;
    }
  });

  async function grantAdmin(token: string): Promise<void> {
    await request(app.getHttpServer())
      .get('/api/v1/rhythms')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const em = app.get(EntityManager).fork();
    const auth = TOKEN_TO_AUTH[token];
    const user = await em.findOneOrFail(User, { clerkUserId: auth.userId });
    user.globalRole = GlobalRole.ADMIN;
    await em.flush();
  }

  async function createSong(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SongDetailsResponseDto> {
    const created = await bodyOf<SongDetailsResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/songs')
        .set('Authorization', `Bearer ${token}`)
        .send(minimalSongPayload(category.id, overrides))
        .expect(201),
    );
    createdSongIds.push(created.id);
    return created;
  }

  async function publishSong(token: string, id: string): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/submit`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/songs/${id}/publish`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
  }

  async function createInstrument(
    overrides: Record<string, unknown> = {},
  ): Promise<InstrumentDetailsResponseDto> {
    const suffix = randomUUID().slice(0, 8);
    const created = await bodyOf<InstrumentDetailsResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/admin/instruments')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send({
          name: `Test instrument ${suffix}`,
          alternativeNames: [],
          shortDescription: null,
          description: null,
          history: null,
          construction: null,
          howToPlay: null,
          roleInBateria: null,
          displayOrder: 1,
          isActive: true,
          media: [],
          ...overrides,
        })
        .expect(201),
    );
    createdInstrumentIds.push(created.id);
    return created;
  }

  function rhythmPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    const suffix = randomUUID().slice(0, 8);
    return {
      name: `Test São Bento ${suffix}`,
      alternativeNames: [],
      shortDescription: 'A slow rhythm',
      description: null,
      history: null,
      usage: null,
      character: null,
      tempoDescription: 'Slow',
      tempoMinBpm: 60,
      tempoMaxBpm: 90,
      displayOrder: 1,
      isActive: true,
      media: [],
      instrumentLinks: [],
      songLinks: [],
      ...overrides,
    };
  }

  async function createRhythm(
    payload: Record<string, unknown>,
  ): Promise<RhythmDetailsResponseDto> {
    const res = await request(app.getHttpServer())
      .post('/api/v1/admin/rhythms')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(payload);
    if (res.status !== 201) {
      // eslint-disable-next-line no-console
      console.error(
        'DIAG createRhythm failed',
        res.status,
        JSON.stringify(res.body),
        'payload=',
        JSON.stringify(payload),
      );
    }
    expect(res.status).toBe(201);
    const created = res.body as RhythmDetailsResponseDto;
    createdRhythmIds.push(created.id);
    return created;
  }

  describe('admin CRUD', () => {
    it('creates a rhythm with media, instrumentLinks and songLinks in one transaction', async () => {
      const instrument = await createInstrument();
      const song = await createSong(OWNER_TOKEN);

      const created = await createRhythm(
        rhythmPayload({
          media: [
            {
              type: 'VIDEO',
              url: 'https://example.com/video.mp4',
              title: null,
              description: null,
              displayOrder: 1,
              instrumentId: instrument.id,
            },
          ],
          instrumentLinks: [
            {
              instrumentId: instrument.id,
              roleDescription: 'Leads the rhythm',
              displayOrder: 1,
            },
          ],
          songLinks: [
            {
              songId: song.id,
              isPrimary: true,
              description: 'Classic example',
            },
          ],
        }),
      );

      expect(created.media).toHaveLength(1);
      expect(created.media[0].instrumentId).toBe(instrument.id);
      expect(created.instruments).toEqual([
        {
          id: instrument.id,
          slug: instrument.slug,
          name: instrument.name,
          shortDescription: instrument.shortDescription,
          roleDescription: 'Leads the rhythm',
          displayOrder: 1,
        },
      ]);
      expect(created.songs).toHaveLength(1);
      expect(created.songs[0]).toMatchObject({
        id: song.id,
        isPrimary: true,
        relationDescription: 'Classic example',
      });
    });

    it('rejects tempoMinBpm greater than tempoMaxBpm with VALIDATION_ERROR', async () => {
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/admin/rhythms')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(rhythmPayload({ tempoMinBpm: 100, tempoMaxBpm: 50 }))
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('rejects duplicate instrumentIds within instrumentLinks with VALIDATION_ERROR', async () => {
      const instrument = await createInstrument();

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/admin/rhythms')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(
            rhythmPayload({
              instrumentLinks: [
                {
                  instrumentId: instrument.id,
                  roleDescription: null,
                  displayOrder: 1,
                },
                {
                  instrumentId: instrument.id,
                  roleDescription: null,
                  displayOrder: 2,
                },
              ],
            }),
          )
          .expect(400),
      );
      expect(response.code).toBe('VALIDATION_ERROR');
    });

    it('rejects an instrumentLinks entry referencing a non-existent instrument with 400', async () => {
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/admin/rhythms')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(
            rhythmPayload({
              instrumentLinks: [
                {
                  instrumentId: randomUUID(),
                  roleDescription: null,
                  displayOrder: 1,
                },
              ],
            }),
          )
          .expect(400),
      );
      expect(response.code).toBe('INVALID_INSTRUMENT_IDS');
    });

    it('rejects a songLinks entry referencing a non-existent song with 400', async () => {
      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .post('/api/v1/admin/rhythms')
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(
            rhythmPayload({
              songLinks: [
                { songId: randomUUID(), isPrimary: false, description: null },
              ],
            }),
          )
          .expect(400),
      );
      expect(response.code).toBe('INVALID_SONG_IDS');
    });

    it('does not persist a rhythm when an invalid instrumentLinks reference makes the whole request fail', async () => {
      // Checked by this specific slug rather than a global Rhythm count -
      // other e2e spec files create/remove their own Rhythm rows in
      // parallel test workers against the same database, so a table-wide
      // count is not stable across files.
      const em = app.get(EntityManager).fork();
      const slug = `test-rollback-${randomUUID().slice(0, 8)}`;

      await request(app.getHttpServer())
        .post('/api/v1/admin/rhythms')
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .send(
          rhythmPayload({
            slug,
            instrumentLinks: [
              {
                instrumentId: randomUUID(),
                roleDescription: null,
                displayOrder: 1,
              },
            ],
          }),
        )
        .expect(400);

      expect(await em.count(Rhythm, { slug })).toBe(0);
    });

    it('un-primaries the previous rhythm when a song is assigned a new primary rhythm', async () => {
      const song = await createSong(OWNER_TOKEN);
      const rhythmA = await createRhythm(
        rhythmPayload({
          songLinks: [{ songId: song.id, isPrimary: true, description: null }],
        }),
      );

      const rhythmB = await createRhythm(
        rhythmPayload({
          songLinks: [{ songId: song.id, isPrimary: true, description: null }],
        }),
      );

      const refreshedA = await bodyOf<RhythmDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/admin/rhythms/${rhythmA.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );
      const refreshedB = await bodyOf<RhythmDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/admin/rhythms/${rhythmB.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(200),
      );

      expect(refreshedA.songs[0].isPrimary).toBe(false);
      expect(refreshedB.songs[0].isPrimary).toBe(true);
    });

    it('updates a rhythm, replacing media/instrumentLinks/songLinks wholesale', async () => {
      const instrument1 = await createInstrument();
      const instrument2 = await createInstrument();
      const created = await createRhythm(
        rhythmPayload({
          instrumentLinks: [
            {
              instrumentId: instrument1.id,
              roleDescription: null,
              displayOrder: 1,
            },
          ],
        }),
      );
      expect(created.instruments).toHaveLength(1);

      const updated = await bodyOf<RhythmDetailsResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/admin/rhythms/${created.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .send(
            rhythmPayload({
              name: created.name,
              slug: created.slug,
              instrumentLinks: [
                {
                  instrumentId: instrument2.id,
                  roleDescription: 'Now this one',
                  displayOrder: 1,
                },
              ],
            }),
          )
          .expect(200),
      );

      expect(updated.instruments).toHaveLength(1);
      expect(updated.instruments[0].id).toBe(instrument2.id);
    });

    it('blocks deletion with 409 RHYTHM_HAS_RELATIONS when it has links', async () => {
      const song = await createSong(OWNER_TOKEN);
      const created = await createRhythm(
        rhythmPayload({
          songLinks: [{ songId: song.id, isPrimary: false, description: null }],
        }),
      );

      const response = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .delete(`/api/v1/admin/rhythms/${created.id}`)
          .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
          .expect(409),
      );
      expect(response.code).toBe('RHYTHM_HAS_RELATIONS');
    });

    it('deletes a rhythm with no links', async () => {
      const created = await createRhythm(rhythmPayload());

      await request(app.getHttpServer())
        .delete(`/api/v1/admin/rhythms/${created.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(204);

      await request(app.getHttpServer())
        .get(`/api/v1/admin/rhythms/${created.id}`)
        .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
        .expect(404);

      createdRhythmIds.splice(createdRhythmIds.indexOf(created.id), 1);
    });

    it('rejects requests from a non-admin user with 403', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/admin/rhythms')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(403);
    });
  });

  describe('public catalogue', () => {
    it('lists only active rhythms, ordered by displayOrder then name', async () => {
      const first = await createRhythm(
        rhythmPayload({ name: 'AAA First', displayOrder: 1 }),
      );
      const second = await createRhythm(
        rhythmPayload({ name: 'ZZZ Second', displayOrder: 1 }),
      );
      const inactive = await createRhythm(rhythmPayload({ isActive: false }));

      const list = await bodyOf<RhythmListItemResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/rhythms')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      const ids = list.map((item) => item.id);
      expect(ids).not.toContain(inactive.id);
      expect(ids.indexOf(first.id)).toBeLessThan(ids.indexOf(second.id));
    });

    it('filters by instrumentId', async () => {
      const instrument = await createInstrument();
      const linked = await createRhythm(
        rhythmPayload({
          instrumentLinks: [
            {
              instrumentId: instrument.id,
              roleDescription: null,
              displayOrder: 1,
            },
          ],
        }),
      );
      const unlinked = await createRhythm(rhythmPayload());

      const list = await bodyOf<RhythmListItemResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/rhythms')
          .query({ instrumentId: instrument.id })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      const ids = list.map((item) => item.id);
      expect(ids).toContain(linked.id);
      expect(ids).not.toContain(unlinked.id);
    });

    it('returns 404 for an inactive rhythm', async () => {
      const created = await createRhythm(rhythmPayload({ isActive: false }));

      await request(app.getHttpServer())
        .get(`/api/v1/rhythms/${created.slug}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(404);
    });

    it("only shows songs visible to the requesting user in a rhythm's details", async () => {
      const ownerDraftSong = await createSong(OWNER_TOKEN);
      const publishedSong = await createSong(OWNER_TOKEN);
      await publishSong(OWNER_TOKEN, publishedSong.id);

      const created = await createRhythm(
        rhythmPayload({
          songLinks: [
            { songId: ownerDraftSong.id, isPrimary: false, description: null },
            { songId: publishedSong.id, isPrimary: false, description: null },
          ],
        }),
      );

      const ownerView = await bodyOf<RhythmDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/rhythms/${created.slug}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const ownerSongIds = ownerView.songs.map((song) => song.id);
      expect(ownerSongIds).toContain(ownerDraftSong.id);
      expect(ownerSongIds).toContain(publishedSong.id);

      const otherView = await bodyOf<RhythmDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/rhythms/${created.slug}`)
          .set('Authorization', `Bearer ${OTHER_TOKEN}`)
          .expect(200),
      );
      const otherSongIds = otherView.songs.map((song) => song.id);
      expect(otherSongIds).not.toContain(ownerDraftSong.id);
      expect(otherSongIds).toContain(publishedSong.id);
    });

    it("only shows active instruments in a rhythm's details", async () => {
      const activeInstrument = await createInstrument();
      const inactiveInstrument = await createInstrument({ isActive: false });

      const created = await createRhythm(
        rhythmPayload({
          instrumentLinks: [
            {
              instrumentId: activeInstrument.id,
              roleDescription: null,
              displayOrder: 1,
            },
            {
              instrumentId: inactiveInstrument.id,
              roleDescription: null,
              displayOrder: 2,
            },
          ],
        }),
      );

      const details = await bodyOf<RhythmDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/rhythms/${created.slug}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      const instrumentIds = details.instruments.map((i) => i.id);
      expect(instrumentIds).toContain(activeInstrument.id);
      expect(instrumentIds).not.toContain(inactiveInstrument.id);
    });
  });

  describe('SongDetails.rhythms', () => {
    it('includes active rhythms linked to the song', async () => {
      const song = await createSong(OWNER_TOKEN);
      const rhythm = await createRhythm(
        rhythmPayload({
          songLinks: [
            {
              songId: song.id,
              isPrimary: true,
              description: 'Great example',
            },
          ],
        }),
      );

      const details = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(details.rhythms).toEqual([
        {
          id: rhythm.id,
          slug: rhythm.slug,
          name: rhythm.name,
          shortDescription: rhythm.shortDescription,
          isPrimary: true,
          description: 'Great example',
        },
      ]);
    });

    it('excludes inactive rhythms', async () => {
      const song = await createSong(OWNER_TOKEN);
      await createRhythm(
        rhythmPayload({
          isActive: false,
          songLinks: [{ songId: song.id, isPrimary: false, description: null }],
        }),
      );

      const details = await bodyOf<SongDetailsResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/songs/${song.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      expect(details.rhythms).toEqual([]);
    });
  });
});
