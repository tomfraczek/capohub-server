import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ClerkAuthService } from './../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from './../src/auth/clerk/clerk-client.provider';
import { GlobalRole } from './../src/auth/permissions/global-role.enum';
import { AuthContext } from './../src/auth/types/auth-context.type';
import { AppConfigService } from './../src/config/app.config';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { closeE2eApp } from './close-e2e-app.helper';
import { User } from './../src/users/entities/user.entity';
import { AvatarType } from './../src/users/enums/avatar-type.enum';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  'valid-test-token': {
    userId: 'user_test_123',
    sessionId: 'sess_test_123',
    tokenType: 'session_token',
    claims: { sub: 'user_test_123', sid: 'sess_test_123' },
  },
  'valid-flow-token': {
    userId: 'user_test_flow',
    sessionId: 'sess_test_flow',
    tokenType: 'session_token',
    claims: { sub: 'user_test_flow', sid: 'sess_test_flow' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  {
    imageUrl: string;
    primaryEmailAddress: { emailAddress: string } | null;
  }
> = {
  user_test_123: {
    imageUrl: 'https://img.clerk.com/test-user.png',
    primaryEmailAddress: { emailAddress: 'test.user@example.com' },
  },
  user_test_flow: {
    imageUrl: 'https://img.clerk.com/flow-tester.png',
    primaryEmailAddress: { emailAddress: 'flow.tester@example.com' },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

// Standard npm run test:e2e must never depend on a real Clerk instance or a
// real session token - Clerk-SDK-touching pieces are unit tested against a
// mocked SDK elsewhere (clerk-auth.service, user.service specs). Only
// UserService + the real Postgres DB run for real here, to prove the
// sync/persist behavior end to end. There are no webhooks: the only
// synchronization path is findOrCreateFromClerk(), driven by an
// authenticated request.
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

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  // One app (and one MikroORM connection pool) for the whole file, like
  // every other *.e2e-spec.ts - a previous beforeEach/afterEach here rebuilt
  // the full app ~25 times per run, which was the dominant source of
  // connection churn behind the "socket hang up" / pool-exhaustion flakes
  // seen under parallel e2e execution. Per-test isolation for the shared
  // Clerk user fixtures is achieved by resetting their rows before each
  // test instead (see beforeEach below), not by recreating the app.
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

  // Several tests reuse the same fixed Clerk user ids (e.g. user_test_flow)
  // to exercise "first login creates it" / fresh avatar / fresh globalRole
  // scenarios - each test needs that row absent at the start, regardless of
  // what an earlier test left behind.
  beforeEach(async () => {
    const em = app.get(EntityManager).fork();
    await em.nativeDelete(User, { clerkUserId: { $in: TEST_CLERK_USER_IDS } });
  });

  // Requires a reachable local PostgreSQL database (see DATABASE_URL in .env).
  it('GET /api/v1/health returns ok status with an up database', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);

    expect(response.body).toMatchObject({
      status: 'ok',
      service: 'capoeira-hub-api',
      environment: 'test',
      database: { status: 'up' },
    });
  });

  it('GET /api/v1/unknown returns a consistent error format', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/unknown')
      .expect(404);

    expect(response.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      path: '/api/v1/unknown',
    });
  });

  it('GET /api/v1/auth/session without a token returns 401', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .expect(401);

    expect(response.body).toMatchObject({
      statusCode: 401,
      code: 'UNAUTHORIZED',
      message: 'Authentication required',
      path: '/api/v1/auth/session',
    });
  });

  it('GET /api/v1/auth/session with an invalid token returns 401', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', 'Bearer invalid-token')
      .expect(401);
  });

  it('GET /api/v1/auth/session with a valid token returns the session', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/auth/session')
      .set('Authorization', 'Bearer valid-test-token')
      .expect(200);

    expect(response.body).toEqual({
      authenticated: true,
      userId: 'user_test_123',
      sessionId: 'sess_test_123',
    });
  });

  it('GET /api/v1/users/me without a token returns 401', async () => {
    await request(app.getHttpServer()).get('/api/v1/users/me').expect(401);
  });

  it(
    'syncs a Clerk user to the local DB on first request, reuses it on the ' +
      'next one, generates a displayName, and supports profile updates via PATCH',
    async () => {
      const em = app.get(EntityManager).fork();

      // 1. First authenticated request creates the local User.
      const firstResponse = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(firstResponse.body).toMatchObject({
        email: 'flow.tester@example.com',
        displayName: 'Flow Tester',
        theme: 'system',
        notificationsEnabled: true,
        globalRole: GlobalRole.USER,
        // USER holds SONG_READ/SONG_CREATE/SONG_EDIT_OWN (see
        // role-permissions.map.ts) - it can create/edit its own songs, but
        // has no moderation or deletion capability.
        songCapabilities: {
          canCreate: true,
          canApproveContent: false,
          canHideContent: false,
          canDeleteAnyDraft: false,
        },
      });
      expect(firstResponse.body).not.toHaveProperty('clerkUserId');

      const afterFirst = await em.count(User, {
        clerkUserId: 'user_test_flow',
      });
      expect(afterFirst).toBe(1);

      // 2. A second request must not create a second row.
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      const afterSecond = await em.count(User, {
        clerkUserId: 'user_test_flow',
      });
      expect(afterSecond).toBe(1);

      // 3. PATCH updates displayName/theme/notificationsEnabled.
      const patchResponse = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ displayName: 'Updated Name', theme: 'dark' })
        .expect(200);

      expect(patchResponse.body).toMatchObject({
        displayName: 'Updated Name',
        theme: 'dark',
      });

      // 4. A subsequent GET reflects the new data and keeps displayName -
      // sync (findOrCreateFromClerk) must not overwrite the local edit.
      const afterPatchResponse = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(afterPatchResponse.body).toMatchObject({
        displayName: 'Updated Name',
        theme: 'dark',
      });

      const finalCount = await em.count(User, {
        clerkUserId: 'user_test_flow',
      });
      expect(finalCount).toBe(1);
    },
  );

  it('sets lastLoginAt on creation and never updates it on later requests', async () => {
    const em = app.get(EntityManager).fork();

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer valid-flow-token')
      .expect(200);

    const afterFirst = await em.findOneOrFail(User, {
      clerkUserId: 'user_test_flow',
    });
    expect(afterFirst.lastLoginAt).not.toBeNull();
    const firstLoginAt = afterFirst.lastLoginAt?.getTime();

    // Wait past timer resolution so a bug (touching lastLoginAt again) would
    // be observable as a different timestamp.
    await new Promise((resolve) => setTimeout(resolve, 5));

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer valid-flow-token')
      .expect(200);

    const em2 = app.get(EntityManager).fork();
    const afterSecond = await em2.findOneOrFail(User, {
      clerkUserId: 'user_test_flow',
    });
    expect(afterSecond.lastLoginAt?.getTime()).toBe(firstLoginAt);
  });

  it('PATCH /api/v1/users/me without a token returns 401', async () => {
    await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .send({ displayName: 'Nope' })
      .expect(401);
  });

  it('PATCH /api/v1/users/me cannot change globalRole', async () => {
    const getRes = await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer valid-flow-token');

    console.error(
      'DIAG globalRole GET',
      getRes.status,
      JSON.stringify(getRes.body),
    );
    expect(getRes.status).toBe(200);

    const patchRes = await request(app.getHttpServer())
      .patch('/api/v1/users/me')
      .set('Authorization', 'Bearer valid-flow-token')
      .send({ displayName: 'Still Just A User', globalRole: 'SUPER_ADMIN' });

    console.error(
      'DIAG globalRole PATCH',
      patchRes.status,
      JSON.stringify(patchRes.body),
    );
    expect(patchRes.status).toBe(200);
    const patchResponse = patchRes;

    expect(patchResponse.body).toMatchObject({
      displayName: 'Still Just A User',
      globalRole: GlobalRole.USER,
    });

    const em = app.get(EntityManager).fork();
    const persisted = await em.findOneOrFail(User, {
      clerkUserId: 'user_test_flow',
    });
    expect(persisted.globalRole).toBe(GlobalRole.USER);
  });

  describe('avatar', () => {
    it('GET /api/v1/users/me returns avatarType and presetAvatarId', async () => {
      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(response.body).toMatchObject({
        avatarType: 'CLERK',
        avatarUrl: 'https://img.clerk.com/flow-tester.png',
        presetAvatarId: null,
      });
    });

    it('PUT /api/v1/users/me/avatar/preset sets a PRESET avatar and clears avatarUrl', async () => {
      const response = await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/preset')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ presetAvatarId: 'berimbau-01' })
        .expect(200);

      expect(response.body).toMatchObject({
        avatarType: 'PRESET',
        presetAvatarId: 'berimbau-01',
        avatarUrl: null,
      });
    });

    it('PUT /api/v1/users/me/avatar/preset rejects an invalid presetAvatarId', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/preset')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ presetAvatarId: 'Not Valid!' })
        .expect(400);
    });

    it('PUT /api/v1/users/me/avatar/preset without a token returns 401', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/preset')
        .send({ presetAvatarId: 'berimbau-01' })
        .expect(401);
    });

    it('a subsequent GET keeps PRESET - Clerk sync must not overwrite it', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/preset')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ presetAvatarId: 'berimbau-02' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(response.body).toMatchObject({
        avatarType: 'PRESET',
        presetAvatarId: 'berimbau-02',
        avatarUrl: null,
      });
    });

    it('PUT /api/v1/users/me/avatar/clerk restores the current Clerk avatar and clears presetAvatarId', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/preset')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ presetAvatarId: 'berimbau-01' })
        .expect(200);

      const response = await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/clerk')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(response.body).toMatchObject({
        avatarType: 'CLERK',
        avatarUrl: 'https://img.clerk.com/flow-tester.png',
        presetAvatarId: null,
      });

      const em = app.get(EntityManager).fork();
      const persisted = await em.findOneOrFail(User, {
        clerkUserId: 'user_test_flow',
      });
      expect(persisted.avatarType).toBe(AvatarType.CLERK);
      expect(persisted.presetAvatarId).toBeNull();
    });

    it('PUT /api/v1/users/me/avatar/clerk without a token returns 401', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/clerk')
        .expect(401);
    });

    it('PATCH /api/v1/users/me cannot change avatarType, avatarUrl or presetAvatarId', async () => {
      await request(app.getHttpServer())
        .put('/api/v1/users/me/avatar/preset')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ presetAvatarId: 'berimbau-01' })
        .expect(200);

      const patchResponse = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({
          displayName: 'Still Mine',
          avatarType: 'UPLOAD',
          avatarUrl: 'https://evil.example.com/avatar.png',
          presetAvatarId: 'hacked',
        })
        .expect(200);

      expect(patchResponse.body).toMatchObject({
        displayName: 'Still Mine',
        avatarType: 'PRESET',
        presetAvatarId: 'berimbau-01',
        avatarUrl: null,
      });

      const em = app.get(EntityManager).fork();
      const persisted = await em.findOneOrFail(User, {
        clerkUserId: 'user_test_flow',
      });
      expect(persisted.avatarType).toBe(AvatarType.PRESET);
      expect(persisted.presetAvatarId).toBe('berimbau-01');
      expect(persisted.avatarUrl).toBeNull();
    });
  });

  it('DELETE /api/v1/users/me deletes the local user (and the Clerk account)', async () => {
    const em = app.get(EntityManager).fork();

    await request(app.getHttpServer())
      .get('/api/v1/users/me')
      .set('Authorization', 'Bearer valid-flow-token')
      .expect(200);
    expect(await em.count(User, { clerkUserId: 'user_test_flow' })).toBe(1);

    await request(app.getHttpServer())
      .delete('/api/v1/users/me')
      .set('Authorization', 'Bearer valid-flow-token')
      .expect(204);

    expect(await em.count(User, { clerkUserId: 'user_test_flow' })).toBe(0);
  });

  it('DELETE /api/v1/users/me without a token returns 401', async () => {
    await request(app.getHttpServer()).delete('/api/v1/users/me').expect(401);
  });

  describe('GET /api/v1/auth/permissions-test', () => {
    it('without a token returns 401', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/auth/permissions-test')
        .expect(401);
    });

    it('with a USER-role account returns 403 (missing USER_MANAGE)', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      await request(app.getHttpServer())
        .get('/api/v1/auth/permissions-test')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(403);
    });

    it('with an ADMIN-role account returns 200', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: 'user_test_flow',
      });
      user.globalRole = GlobalRole.ADMIN;
      await em.flush();

      const response = await request(app.getHttpServer())
        .get('/api/v1/auth/permissions-test')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(response.body).toEqual({
        ok: true,
        globalRole: GlobalRole.ADMIN,
      });

      // ADMIN holds SONG_CREATE, CONTENT_APPROVE, CONTENT_HIDE and
      // SONG_DELETE (see role-permissions.map.ts), so all four Songs
      // capabilities are true.
      const meResponse = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(meResponse.body).toMatchObject({
        globalRole: GlobalRole.ADMIN,
        songCapabilities: {
          canCreate: true,
          canApproveContent: true,
          canHideContent: true,
          canDeleteAnyDraft: true,
        },
      });
    });
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const em = app.get(EntityManager).fork();
      await em.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });
});
