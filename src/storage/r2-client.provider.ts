import { Provider } from '@nestjs/common';
import { S3Client } from '@aws-sdk/client-s3';
import { AppConfigService } from '../config/app.config';

/**
 * The only place in the project that constructs an S3Client for Cloudflare
 * R2 - mirrors clerk-client.provider.ts's CLERK_CLIENT (the same
 * "useFactory + fail readable at DI-resolution time" pattern for a
 * low-level external client). Deliberately not part of envSchema's own
 * validation (see env.schema.ts's comment on R2_*) - this factory is what
 * actually enforces "every R2_* var must be present" for any environment
 * that constructs a real R2StorageService, at the moment that service is
 * first resolved, rather than the whole app failing to boot even for
 * environments/tests that never touch storage.
 *
 * Tests that exercise upload endpoints override R2StorageService itself
 * (see test/events.e2e-spec.ts-style overrideProvider usage) - overriding
 * a provider with .useValue() replaces it in the DI container without ever
 * invoking its real constructor/factory, so this factory (and the "real R2
 * credentials must be present" check below) never runs for those tests
 * either.
 */
export const R2_CLIENT = Symbol('R2_CLIENT');

export const r2ClientProvider: Provider = {
  provide: R2_CLIENT,
  inject: [AppConfigService],
  useFactory: (appConfig: AppConfigService): S3Client => {
    assertR2Configured(appConfig);
    return new S3Client({
      region: 'auto',
      endpoint: appConfig.r2Endpoint,
      credentials: {
        accessKeyId: appConfig.r2AccessKeyId,
        secretAccessKey: appConfig.r2SecretAccessKey,
      },
    });
  },
};

export function assertR2Configured(appConfig: AppConfigService): void {
  const missing = [
    ['R2_ENDPOINT', appConfig.r2Endpoint],
    ['R2_ACCESS_KEY_ID', appConfig.r2AccessKeyId],
    ['R2_SECRET_ACCESS_KEY', appConfig.r2SecretAccessKey],
    ['R2_BUCKET', appConfig.r2Bucket],
    ['R2_PUBLIC_URL', appConfig.r2PublicUrl],
  ]
    .filter(([, value]) => !value)
    .map(([name]) => name);

  if (missing.length > 0) {
    throw new Error(
      `R2 storage is not configured - missing required environment variable(s): ${missing.join(', ')}. See .env.example.`,
    );
  }
}
