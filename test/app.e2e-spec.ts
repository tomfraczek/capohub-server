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
import { AuthContext } from './../src/auth/types/auth-context.type';
import { AppConfigService } from './../src/config/app.config';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';
import { User } from './../src/users/entities/user.entity';

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
    firstName: string | null;
    lastName: string | null;
    imageUrl: string;
    primaryEmailAddress: { emailAddress: string } | null;
  }
> = {
  user_test_123: {
    firstName: 'Test',
    lastName: 'User',
    imageUrl: 'https://img.clerk.com/test-user.png',
    primaryEmailAddress: { emailAddress: 'test.user@example.com' },
  },
  user_test_flow: {
    firstName: 'Flow',
    lastName: 'Tester',
    imageUrl: 'https://img.clerk.com/flow-tester.png',
    primaryEmailAddress: { emailAddress: 'flow.tester@example.com' },
  },
};

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

// Standard npm run test:e2e must never depend on a real Clerk instance or a
// real session token - both token verification and the Clerk profile lookup
// are unit tested against a mocked SDK elsewhere (clerk-auth.service.spec.ts,
// user.service.spec.ts). Only UserService + the real Postgres DB run for
// real here, to prove the sync/persist behavior end to end.
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
  },
};

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
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
      'next one, and supports profile updates via PATCH',
    async () => {
      const em = app.get(EntityManager).fork();

      // 1. First authenticated request creates the local User.
      const firstResponse = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect(firstResponse.body).toMatchObject({
        email: 'flow.tester@example.com',
        firstName: 'Flow',
        lastName: 'Tester',
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

      // 3. PATCH updates firstName.
      const patchResponse = await request(app.getHttpServer())
        .patch('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .send({ firstName: 'Updated' })
        .expect(200);

      expect((patchResponse.body as { firstName: string }).firstName).toBe(
        'Updated',
      );

      // 4. A subsequent GET reflects the new data.
      const afterPatchResponse = await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', 'Bearer valid-flow-token')
        .expect(200);

      expect((afterPatchResponse.body as { firstName: string }).firstName).toBe(
        'Updated',
      );

      const finalCount = await em.count(User, {
        clerkUserId: 'user_test_flow',
      });
      expect(finalCount).toBe(1);
    },
  );

  afterEach(async () => {
    const em = app.get(EntityManager).fork();
    await em.nativeDelete(User, { clerkUserId: { $in: TEST_CLERK_USER_IDS } });
    await app.close();
  });
});
