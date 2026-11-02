import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { MikroORM } from '@mikro-orm/core';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app.config';
import {
  applyPendingMigrations,
  describeMigrationError,
} from './database/migrate';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { RequestLoggingInterceptor } from './common/interceptors/request-logging.interceptor';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const appConfig = app.get(AppConfigService);

  // Not a hard failure (a staging-like production on a dev Clerk instance
  // can be intentional), but never silent: dev instances have strict rate
  // limits and their users are separate from the production instance's.
  if (
    appConfig.isProduction &&
    appConfig.clerkSecretKey.startsWith('sk_test_')
  ) {
    Logger.warn(
      'NODE_ENV=production is using a Clerk development instance key (sk_test_) - the mobile app must use the same instance, and dev instances are not meant for production traffic',
      'Bootstrap',
    );
  }

  // Pending migrations are applied on every start, on the MikroORM instance
  // DatabaseModule already connected, before listen() - which is also what
  // runs app init, so neither HTTP traffic nor the scheduler's cron jobs
  // ever see a half-migrated schema. A failure stops the process instead of
  // serving requests against a schema the code doesn't expect. See
  // docs/digitalocean-production.md for the deployment implications.
  try {
    await applyPendingMigrations(app.get(MikroORM));
  } catch (error) {
    Logger.error(
      `Startup migrations failed - not starting the HTTP server: ${describeMigrationError(error, appConfig.databaseUrl)}`,
      undefined,
      'Bootstrap',
    );
    try {
      await app.close();
    } finally {
      process.exit(1);
    }
  }

  app.setGlobalPrefix(appConfig.apiPrefix);
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: appConfig.apiVersion,
    prefix: false,
  });

  app.use(helmet());
  app.enableCors({
    origin: appConfig.corsOrigins,
    credentials: true,
  });

  app.useBodyParser('json', { limit: '1mb' });

  app.useGlobalFilters(new HttpExceptionFilter());
  app.useGlobalInterceptors(new RequestLoggingInterceptor());

  app.enableShutdownHooks();

  await app.listen(appConfig.port, '0.0.0.0');
  Logger.log(
    `Application listening on http://0.0.0.0:${appConfig.port}/${appConfig.apiPrefix}/${appConfig.apiVersion}`,
    'Bootstrap',
  );
}

void bootstrap();
