import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from './env.schema';

@Injectable()
export class AppConfigService {
  constructor(private readonly configService: ConfigService<EnvConfig, true>) {}

  get nodeEnv(): EnvConfig['NODE_ENV'] {
    return this.configService.get('NODE_ENV', { infer: true });
  }

  get port(): number {
    return this.configService.get('PORT', { infer: true });
  }

  get apiPrefix(): string {
    return this.configService.get('API_PREFIX', { infer: true });
  }

  get apiVersion(): string {
    return this.configService.get('API_VERSION', { infer: true });
  }

  get corsOrigins(): string[] {
    return this.configService.get('CORS_ORIGINS', { infer: true });
  }

  get databaseUrl(): string {
    return this.configService.get('DATABASE_URL', { infer: true });
  }

  get databaseSsl(): boolean {
    return this.configService.get('DATABASE_SSL', { infer: true });
  }

  get clerkSecretKey(): string {
    return this.configService.get('CLERK_SECRET_KEY', { infer: true });
  }

  get clerkPublishableKey(): string | undefined {
    return this.configService.get('CLERK_PUBLISHABLE_KEY', { infer: true });
  }

  get clerkJwtKey(): string | undefined {
    return this.configService.get('CLERK_JWT_KEY', { infer: true });
  }

  get clerkAuthorizedParties(): string[] {
    return this.configService.get('CLERK_AUTHORIZED_PARTIES', {
      infer: true,
    });
  }

  // Possibly empty strings - see env.schema.ts's own comment on why these
  // are not validated as required here. R2StorageService's provider
  // factory is what actually enforces non-empty (see r2-client.provider.ts).
  get r2Endpoint(): string {
    return this.configService.get('R2_ENDPOINT', { infer: true });
  }

  get r2AccessKeyId(): string {
    return this.configService.get('R2_ACCESS_KEY_ID', { infer: true });
  }

  get r2SecretAccessKey(): string {
    return this.configService.get('R2_SECRET_ACCESS_KEY', { infer: true });
  }

  get r2Bucket(): string {
    return this.configService.get('R2_BUCKET', { infer: true });
  }

  get r2PublicUrl(): string {
    return this.configService.get('R2_PUBLIC_URL', { infer: true });
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isTest(): boolean {
    return this.nodeEnv === 'test';
  }
}
