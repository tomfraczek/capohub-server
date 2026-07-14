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
