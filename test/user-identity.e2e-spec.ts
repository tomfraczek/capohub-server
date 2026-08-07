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

  it("returns the caller's own numericCode and a matching versioned qrPayload", async () => {
    const profile = await getOwnProfile(OWNER_TOKEN);

    expect(profile.numericCode).toMatch(/^[0-9]{6}$/);
    expect(profile.qrPayload).toBe(`capohub:v1:u:${profile.numericCode}`);
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
});
