/**
 * E2E tests for the User side of the numericCode/QR identity module: own
 * profile exposing numericCode/qrPayload, immutability, lookup by code
 * (raw and "123-456" display format), privacy, and malformed-input
 * handling. See event-identity.e2e-spec.ts for the Event side.
 */

import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
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
import { UserProfileResponseDto } from '../src/users/dto/user-profile-response.dto';
import { PublicUserProfileResponseDto } from '../src/users/dto/public-user-profile-response.dto';

const CONFIGURED_WEB_BASE_URL = 'https://capohub.test';

const OWNER_TOKEN = 'valid-user-identity-owner-token';
const VIEWER_TOKEN = 'valid-user-identity-viewer-token';

const OWNER_CLERK_ID = 'user_test_identity_owner';
const VIEWER_CLERK_ID = 'user_test_identity_viewer';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [OWNER_TOKEN]: {
    userId: OWNER_CLERK_ID,
    sessionId: 'sess_identity_owner',
    tokenType: 'session_token',
    claims: { sub: OWNER_CLERK_ID, sid: 'sess_identity_owner' },
  },
  [VIEWER_TOKEN]: {
    userId: VIEWER_CLERK_ID,
    sessionId: 'sess_identity_viewer',
    tokenType: 'session_token',
    claims: { sub: VIEWER_CLERK_ID, sid: 'sess_identity_viewer' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {
  [OWNER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/identity-owner.png',
    primaryEmailAddress: { emailAddress: 'identity.owner@example.com' },
  },
  [VIEWER_CLERK_ID]: {
    imageUrl: 'https://img.clerk.com/identity-viewer.png',
    primaryEmailAddress: { emailAddress: 'identity.viewer@example.com' },
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

describe('User Identity (e2e)', () => {
  let app: INestApplication<App>;
  let appConfig: AppConfigService;

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
    appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    // This suite exercises the User QR/qrPayload flow end-to-end, which
    // needs a real, deterministic PUBLIC_WEB_BASE_URL regardless of
    // whatever the actual .env does or doesn't have configured (see
    // qr-payload.util.ts) - overridden here rather than relying on the
    // ambient environment, same approach as event-attendance.e2e-spec.ts/
    // training-check-in.e2e-spec.ts's own check-in-by-QR tests.
    jest
      .spyOn(appConfig, 'publicWebBaseUrl', 'get')
      .mockReturnValue(CONFIGURED_WEB_BASE_URL);

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  async function getOwnProfile(token: string): Promise<UserProfileResponseDto> {
    return bodyOf<UserProfileResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  it("returns the caller's own numericCode and a matching public https:// qrPayload", async () => {
    const profile = await getOwnProfile(OWNER_TOKEN);

    expect(profile.numericCode).toMatch(/^[0-9]{6}$/);
    expect(profile.qrPayload).toBe(
      `${CONFIGURED_WEB_BASE_URL}/u/${profile.numericCode}`,
    );
  });

  it('returns qrPayload: null - never a fabricated placeholder - when no public web domain is configured', async () => {
    jest.spyOn(appConfig, 'publicWebBaseUrl', 'get').mockReturnValue(undefined);
    try {
      const profile = await getOwnProfile(OWNER_TOKEN);
      expect(profile.qrPayload).toBeNull();
    } finally {
      jest
        .spyOn(appConfig, 'publicWebBaseUrl', 'get')
        .mockReturnValue(CONFIGURED_WEB_BASE_URL);
    }
  });

  it('never changes numericCode across an unrelated profile update (PATCH /users/me/profile)', async () => {
    const before = await getOwnProfile(OWNER_TOKEN);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ firstName: 'Ada', lastName: 'Lovelace' })
      .expect(200);

    const after = await getOwnProfile(OWNER_TOKEN);
    expect(after.numericCode).toBe(before.numericCode);
  });

  it('never changes numericCode across a display-name/theme update (PATCH /users/me)', async () => {
    const before = await getOwnProfile(OWNER_TOKEN);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ displayName: 'Ada Renamed' })
      .expect(200);

    const after = await getOwnProfile(OWNER_TOKEN);
    expect(after.numericCode).toBe(before.numericCode);
  });

  it('ignores an attempted numericCode override in the PATCH body - it is not a settable field', async () => {
    const before = await getOwnProfile(OWNER_TOKEN);

    await request(app.getHttpServer())
      .patch('/api/v1/users/me/profile')
      .set('Authorization', `Bearer ${OWNER_TOKEN}`)
      .send({ numericCode: '999999' })
      .expect(200);

    const after = await getOwnProfile(OWNER_TOKEN);
    expect(after.numericCode).toBe(before.numericCode);
    expect(after.numericCode).not.toBe('999999');
  });

  describe('GET /users/by-code/:code', () => {
    it('resolves the raw 6-digit code to the public profile', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);

      const found = await bodyOf<PublicUserProfileResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/by-code/${owner.numericCode}`)
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(found.userId).toBe(owner.userId);
    });

    it('resolves the display format with a dash ("123-456") to the same profile', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);
      const dashed = `${owner.numericCode.slice(0, 3)}-${owner.numericCode.slice(3)}`;

      const found = await bodyOf<PublicUserProfileResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/by-code/${dashed}`)
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(found.userId).toBe(owner.userId);
    });

    it('returns the same privacy-filtered shape as GET /users/:userId/profile - firstName/lastName hidden until showFullName is on', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);
      await request(app.getHttpServer())
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ firstName: 'Hidden', lastName: 'Name', showFullName: false })
        .expect(200);

      const byCode = await bodyOf<PublicUserProfileResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/by-code/${owner.numericCode}`)
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(byCode.firstName).toBeNull();
      expect(byCode.lastName).toBeNull();

      await request(app.getHttpServer())
        .patch('/api/v1/users/me/profile')
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ showFullName: true })
        .expect(200);

      const byCodeVisible = await bodyOf<PublicUserProfileResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/users/by-code/${owner.numericCode}`)
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(byCodeVisible.firstName).toBe('Hidden');
      expect(byCodeVisible.lastName).toBe('Name');
    });

    it('never exposes email, clerkUserId, or roles - only the public profile shape', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);

      const found = await bodyOf<Record<string, unknown>>(
        request(app.getHttpServer())
          .get(`/api/v1/users/by-code/${owner.numericCode}`)
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(found).not.toHaveProperty('email');
      expect(found).not.toHaveProperty('clerkUserId');
      expect(found).not.toHaveProperty('globalRole');
      expect(found).not.toHaveProperty('roles');
      expect(found).not.toHaveProperty('memberships');
    });

    it('returns 404 for a well-formed but unassigned code', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/by-code/000000')
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('USER_NOT_FOUND');
    });

    it.each(['12345', '1234567', 'abcdef', '12a456', '', '123-45'])(
      'returns 400 (never 500) for malformed code %p',
      async (malformed) => {
        const error = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .get(`/api/v1/users/by-code/${encodeURIComponent(malformed)}`)
            .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
            .expect((res) => {
              expect(res.status).toBeLessThan(500);
            }),
        );
        expect(error.statusCode).toBeLessThan(500);
      },
    );

    it('returns 401 for an unauthenticated lookup', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/by-code/042981')
        .expect(401);
    });
  });

  // GET /users/resolve-identity - backs the mobile "scan/type someone's
  // code to view their profile" flow (Profile module). Deliberately reuses
  // UserCheckInIdentityService verbatim (see users.controller.ts's own
  // comment) rather than a second identity parser, so it accepts exactly
  // the same three input shapes check-in already does, just for a
  // different (non-check-in) purpose - and returns only `userId`, never
  // profile data, so the real (privacy-filtered) profile always still goes
  // through GET /:userId/profile.
  describe('GET /users/resolve-identity', () => {
    it('resolves a raw 6-digit numericCode to {userId}', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);

      const result = await bodyOf<{ userId: string }>(
        request(app.getHttpServer())
          .get('/api/v1/users/resolve-identity')
          .query({ identity: owner.numericCode })
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(result.userId).toBe(owner.userId);
      expect(Object.keys(result)).toEqual(['userId']);
    });

    it('resolves the frontend "U123-456" display form to {userId}', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);
      const display = `U${owner.numericCode.slice(0, 3)}-${owner.numericCode.slice(3)}`;

      const result = await bodyOf<{ userId: string }>(
        request(app.getHttpServer())
          .get('/api/v1/users/resolve-identity')
          .query({ identity: display })
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(result.userId).toBe(owner.userId);
    });

    it('resolves a full User QR payload to {userId}', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);

      const result = await bodyOf<{ userId: string }>(
        request(app.getHttpServer())
          .get('/api/v1/users/resolve-identity')
          .query({ identity: owner.qrPayload })
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(200),
      );
      expect(result.userId).toBe(owner.userId);
    });

    it('rejects a User QR from a different host than the configured PUBLIC_WEB_BASE_URL', async () => {
      const owner = await getOwnProfile(OWNER_TOKEN);
      const foreignPayload = owner.qrPayload!.replace(
        CONFIGURED_WEB_BASE_URL,
        'https://evil.example',
      );

      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/resolve-identity')
          .query({ identity: foreignPayload })
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(400),
      );
      expect(error.code).toBe('INVALID_CHECK_IN_IDENTITY');
    });

    // The app has no public users yet (see the task history) - these are
    // no longer "legacy, still accepted" shapes, they are plain
    // unrecognized input now, same as any other malformed string.
    it.each(['capohub:v1:u:042981', 'capohub://u/042981'])(
      'no longer resolves the removed legacy User QR shape %p',
      async (removed) => {
        const error = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .get('/api/v1/users/resolve-identity')
            .query({ identity: removed })
            .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
            .expect(400),
        );
        expect(error.code).toBe('INVALID_CHECK_IN_IDENTITY');
      },
    );

    it('rejects a well-formed Event QR payload with WRONG_IDENTITY_TYPE, never resolving it as a User', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/resolve-identity')
          .query({ identity: 'capohub:v1:f:123456' })
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(400),
      );
      expect(error.code).toBe('WRONG_IDENTITY_TYPE');
    });

    it.each(['garbage', 'capohub:v2:u:123456', '12345', ''])(
      'returns 400 INVALID_CHECK_IN_IDENTITY (never 500) for malformed identity %p',
      async (malformed) => {
        const error = await bodyOf<HttpErrorResponse>(
          request(app.getHttpServer())
            .get('/api/v1/users/resolve-identity')
            .query({ identity: malformed })
            .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
            .expect((res) => {
              expect(res.status).toBeLessThan(500);
            }),
        );
        expect(error.statusCode).toBeLessThan(500);
      },
    );

    it('returns 404 USER_NOT_FOUND for a well-formed but unassigned code', async () => {
      const error = await bodyOf<HttpErrorResponse>(
        request(app.getHttpServer())
          .get('/api/v1/users/resolve-identity')
          .query({ identity: '000000' })
          .set('Authorization', `Bearer ${VIEWER_TOKEN}`)
          .expect(404),
      );
      expect(error.code).toBe('USER_NOT_FOUND');
    });

    it('returns 401 for an unauthenticated lookup', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/resolve-identity')
        .query({ identity: '042981' })
        .expect(401);
    });
  });
});
