import { NestFactory } from '@nestjs/core';
import { Logger, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AppConfigService } from './config/app.config';
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
