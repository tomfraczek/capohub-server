import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { ClerkAuthService } from './../src/auth/clerk/clerk-auth.service';
import { AuthContext } from './../src/auth/types/auth-context.type';
import { AppConfigService } from './../src/config/app.config';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

const FIXTURE_AUTH: AuthContext = {
  userId: 'user_test_123',
  sessionId: 'sess_test_123',
  tokenType: 'session_token',
  claims: { sub: 'user_test_123', sid: 'sess_test_123' },
};

// Standard npm run test:e2e must never depend on a real Clerk instance or a
// real session token - the token verification itself is unit tested against
// a mocked SDK in clerk-auth.service.spec.ts.
const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    if (token === 'valid-test-token') {
      return Promise.resolve(FIXTURE_AUTH);
    }
    return Promise.reject(new UnauthorizedException('Authentication required'));
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

  afterEach(async () => {
    await app.close();
  });
});
