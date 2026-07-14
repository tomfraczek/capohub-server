import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { AppConfigService } from './../src/config/app.config';
import { HttpExceptionFilter } from './../src/common/filters/http-exception.filter';

describe('App (e2e)', () => {
  let app: INestApplication<App>;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

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

  afterEach(async () => {
    await app.close();
  });
});
