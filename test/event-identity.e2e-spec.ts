/**
 * E2E tests for the Event side of the numericCode/QR identity module:
 * every Event gets a code at creation, immutability, the per-EventType
 * namespace, QR payload format, lookup by (type, code), and that Event
 * access control is preserved through the lookup. See
 * user-identity.e2e-spec.ts for the User side.
 */

import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import {
  EntityManager,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { HttpErrorResponse } from '../src/common/types/http-error-response.type';
import { closeE2eApp } from './close-e2e-app.helper';
import { User } from '../src/users/entities/user.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { EventResponseDto } from '../src/events/dto/event-response.dto';
import { Event } from '../src/events/entities/event.entity';
import { EventRoleAssignment } from '../src/events/entities/event-role-assignment.entity';
import { EventStatusHistory } from '../src/events/entities/event-status-history.entity';
import { EventVisibility } from '../src/events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../src/events/enums/event-waitlist-policy.enum';

const OWNER_TOKEN = 'valid-event-identity-owner-token';
const OUTSIDER_TOKEN = 'valid-event-identity-outsider-token';

const OWNER_CLERK_ID = 'user_test_event_identity_owner';
const OUTSIDER_CLERK_ID = 'user_test_event_identity_outsider';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_event_identity_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_event_identity_owner' },
  },
  [OUTSIDER_TOKEN]: {
    userId: OUTSIDER_CLERK_ID,
    sessionId: 'sess_event_identity_outsider',
    tokenType: 'session_token',
    claims: { sub: OUTSIDER_CLERK_ID, sid: 'sess_event_identity_outsider' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/event-identity-owner.png',
    primaryEmailAddress: { emailAddress: 'event.identity.owner@example.com' },
  },
  [OUTSIDER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/event-identity-outsider.png',
    primaryEmailAddress: {
      emailAddress: 'event.identity.outsider@example.com',
    },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) return Promise.resolve(auth);
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

describe('Event Identity (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];

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

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      const eventInCommunity = { communityGroup: { $in: createdGroupIds } };
      await cleanup.nativeDelete(EventRoleAssignment, {
        event: eventInCommunity,
      });
      await cleanup.nativeDelete(EventStatusHistory, {
        event: eventInCommunity,
      });
      await cleanup.nativeDelete(Event, eventInCommunity);
      await cleanup.nativeDelete(RoleAssignment, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Event Identity Test Org',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
      ...overrides,
    };
  }

  async function createGroup(token: string): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send(groupPayload())
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  function eventPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      type: 'WORKSHOP',
      customTypeLabel: null,
      name: 'Identity Test Workshop',
      description: null,
      coverImageUrl: null,
      startsAt: '2027-01-10T10:00:00.000Z',
      endsAt: '2027-01-10T18:00:00.000Z',
      locationName: null,
      locationAddress: null,
      latitude: null,
      longitude: null,
      visibility: EventVisibility.COMMUNITY_MEMBERS,
      capacity: null,
      waitlistPolicy: EventWaitlistPolicy.NONE,
      ...overrides,
    };
  }

  async function createEvent(
    token: string,
    groupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<EventResponseDto> {
    return bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${groupId}/events`)
        .set('Authorization', `Bearer ${token}`)
        .send(eventPayload(overrides))
        .expect(201),
    );
  }

  async function publishEvent(
    token: string,
    eventId: string,
  ): Promise<EventResponseDto> {
    return bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${eventId}/publish`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201),
    );
  }

  // Fixed QR protocol discriminators (see common/identity/qr-payload.util.ts)
  // - asserted here independently of that file's own internal map, so this
  // e2e test actually catches a protocol regression rather than just
  // mirroring the implementation.
  const EVENT_TYPE_QR_DISCRIMINATOR: Record<string, string> = {
    FESTIVAL: 'f',
    WORKSHOP: 'w',
    OPEN_RODA: 'r',
    OTHER: 'e',
  };

  it('generates a 6-digit numericCode and matching short qrPayload for a new Event', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const event = await createEvent(OWNER_TOKEN, group.id, {
      type: 'FESTIVAL',
    });

    expect(event.numericCode).toMatch(/^[0-9]{6}$/);
    expect(event.qrPayload).toBe(`capohub:v1:f:${event.numericCode}`);
  });

  it.each(['FESTIVAL', 'WORKSHOP', 'OPEN_RODA', 'OTHER'])(
    'builds the correct short qrPayload for type %s',
    async (type) => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id, {
        type,
        customTypeLabel: type === 'OTHER' ? 'Batizado' : null,
      });

      expect(event.qrPayload).toBe(
        `capohub:v1:${EVENT_TYPE_QR_DISCRIMINATOR[type]}:${event.numericCode}`,
      );
    },
  );

  it('never changes numericCode across an update, publish, or cancel', async () => {
    const group = await createGroup(OWNER_TOKEN);
    const created = await createEvent(OWNER_TOKEN, group.id);
    const originalCode = created.numericCode;

    const updated = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .patch(`/api/v1/events/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ ...eventPayload(), name: 'Renamed Workshop' })
        .expect(200),
    );
    expect(updated.numericCode).toBe(originalCode);

    const published = await publishEvent(OWNER_TOKEN, created.id);
    expect(published.numericCode).toBe(originalCode);

    const cancelled = await bodyOf<EventResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/events/${created.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ reason: 'Test cancellation' })
        .expect(201),
    );
    expect(cancelled.numericCode).toBe(originalCode);
    expect(cancelled.status).toBe('CANCELLED');
  });

  describe('per-EventType namespace', () => {
    it('allows the same numericCode to be reused across two different EventTypes', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const festival = await createEvent(OWNER_TOKEN, group.id, {
        type: 'FESTIVAL',
      });
      const workshop = await createEvent(OWNER_TOKEN, group.id, {
        type: 'WORKSHOP',
      });

      // Force a real, deterministic collision at the DB layer (codes are
      // otherwise random) to prove (type, numericCode) - not numericCode
      // alone - is the actual unique key.
      const em = app.get(EntityManager).fork();
      const sharedCode = '111222';
      await em.nativeUpdate(
        Event,
        { id: festival.id },
        { numericCode: sharedCode },
      );
      await em.nativeUpdate(
        Event,
        { id: workshop.id },
        { numericCode: sharedCode },
      );

      const foundFestival = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/by-code/FESTIVAL/${sharedCode}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      const foundWorkshop = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/by-code/WORKSHOP/${sharedCode}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(foundFestival.id).toBe(festival.id);
      expect(foundWorkshop.id).toBe(workshop.id);
    });

    it('rejects the same (type, numericCode) pair twice at the database level', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const first = await createEvent(OWNER_TOKEN, group.id, {
        type: 'OTHER',
        customTypeLabel: 'A',
      });
      const second = await createEvent(OWNER_TOKEN, group.id, {
        type: 'OTHER',
        customTypeLabel: 'B',
      });

      const em = app.get(EntityManager).fork();
      const firstEntity = await em.findOneOrFail(Event, { id: first.id });

      await expect(
        em.nativeUpdate(
          Event,
          { id: second.id },
          { numericCode: firstEntity.numericCode },
        ),
      ).rejects.toThrow(UniqueConstraintViolationException);
    });
  });

  describe('GET /events/by-code/:type/:code', () => {
    it('finds the exact Event and returns the normal EventResponseDto', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id, {
        type: 'OPEN_RODA',
      });

      const found = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/by-code/OPEN_RODA/${event.numericCode}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(found.id).toBe(event.id);
      expect(found.type).toBe('OPEN_RODA');
    });

    it('preserves normal Event access control - a DRAFT Event is invisible to a non-role-holder via lookup too', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id);

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get(`/api/v1/events/by-code/WORKSHOP/${event.numericCode}`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('EVENT_NOT_FOUND');
    });

    it('a PUBLIC, PUBLISHED Event remains visible to an outsider via lookup', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id, {
        visibility: EventVisibility.PUBLIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const found = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/by-code/WORKSHOP/${event.numericCode}`)
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      expect(found.id).toBe(event.id);
    });

    it('a cancelled Event keeps its exact numericCode reachable by lookup', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id, {
        visibility: EventVisibility.PUBLIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);
      await request(app.getHttpServer())
        .post(`/api/v1/events/${event.id}/cancel`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ reason: 'No longer happening' })
        .expect(201);

      const found = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/events/by-code/WORKSHOP/${event.numericCode}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(found.status).toBe('CANCELLED');
      expect(found.numericCode).toBe(event.numericCode);
    });

    it('returns 400 for an unrecognized EventType segment', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/events/by-code/OPEN_TRAINING/123456')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(400),
      );
      expect(error.code).toBe('INVALID_EVENT_TYPE');
    });

    it.each(['12345', '1234567', 'abcdef', '12a456'])(
      'returns 400 (never 500) for malformed code %p',
      async (malformed) => {
        const error = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .get(`/api/v1/events/by-code/FESTIVAL/${malformed}`)
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(400),
        );
        expect(error.code).toBe('INVALID_NUMERIC_CODE');
      },
    );

    it('returns 404 for a well-formed but unassigned (type, code) pair', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/events/by-code/FESTIVAL/000000')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('EVENT_NOT_FOUND');
    });

    it('returns 401 for an unauthenticated lookup', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/events/by-code/FESTIVAL/123456')
        .expect(401);
    });
  });

  describe('GET /events/by-qr (Event QR resolver)', () => {
    it.each([
      ['FESTIVAL', 'f'],
      ['WORKSHOP', 'w'],
      ['OPEN_RODA', 'r'],
      ['OTHER', 'e'],
    ])(
      'resolves a %s QR payload (letter %s) to the correct Event',
      async (type, letter) => {
        const group = await createGroup(OWNER_TOKEN);
        const event = await createEvent(OWNER_TOKEN, group.id, {
          type,
          customTypeLabel: type === 'OTHER' ? 'Custom Kind' : null,
        });

        const found = await bodyOf<EventResponseDto>(
          request(app.getHttpServer())
            .get('/api/v1/events/by-qr')
            .query({ payload: `capohub:v1:${letter}:${event.numericCode}` })
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(200),
        );
        expect(found.id).toBe(event.id);
        expect(found.type).toBe(type);
      },
    );

    it('rejects a User QR payload - this resolver only ever returns an Event', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/events/by-qr')
          .query({ payload: 'capohub:v1:u:123456' })
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(400),
      );
      expect(error.code).toBe('INVALID_EVENT_QR_PAYLOAD');
    });

    it.each(['garbage', 'capohub:v2:f:123456', 'capohub:v1:x:123456', ''])(
      'returns 400 (never 500) for a malformed QR payload %p',
      async (malformed) => {
        const error = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .get('/api/v1/events/by-qr')
            .query({ payload: malformed })
            .set('Authorization', `Bearer ${OWNER_TOKEN}`)
            .expect(400),
        );
        expect(error.statusCode).toBe(400);
      },
    );

    it('returns 400 when the payload query parameter is missing entirely', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/events/by-qr')
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(400),
      );
      expect(error.code).toBe('MISSING_QR_PAYLOAD');
    });

    it('preserves normal Event access control - a DRAFT Event is invisible to a non-role-holder via QR lookup too', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id, {
        type: 'FESTIVAL',
      });

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/events/by-qr')
          .query({ payload: `capohub:v1:f:${event.numericCode}` })
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('EVENT_NOT_FOUND');
    });

    it('a PUBLIC, PUBLISHED Event remains visible to an outsider via QR lookup', async () => {
      const group = await createGroup(OWNER_TOKEN);
      const event = await createEvent(OWNER_TOKEN, group.id, {
        type: 'FESTIVAL',
        visibility: EventVisibility.PUBLIC,
      });
      await publishEvent(OWNER_TOKEN, event.id);

      const found = await bodyOf<EventResponseDto>(
        request(app.getHttpServer())
          .get('/api/v1/events/by-qr')
          .query({ payload: `capohub:v1:f:${event.numericCode}` })
          .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
          .expect(200),
      );
      expect(found.id).toBe(event.id);
    });

    it('returns 401 for an unauthenticated lookup', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/events/by-qr')
        .query({ payload: 'capohub:v1:f:123456' })
        .expect(401);
    });
  });
});
