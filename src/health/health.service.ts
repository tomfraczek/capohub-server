import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { AppConfigService } from '../config/app.config';
import { DatabaseHealthService } from '../database/health/database-health.service';

export interface HealthStatus {
  status: 'ok';
  service: string;
  environment: string;
  timestamp: string;
  uptime: number;
  database: {
    status: 'up';
  };
}

@Injectable()
export class HealthService {
  private static readonly SERVICE_NAME = 'capoeira-hub-api';

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly databaseHealthService: DatabaseHealthService,
  ) {}

  async getStatus(): Promise<HealthStatus> {
    const database = await this.databaseHealthService.check();

    if (database.status === 'down') {
      throw new ServiceUnavailableException('Database is unavailable');
    }

    return {
      status: 'ok',
      service: HealthService.SERVICE_NAME,
      environment: this.appConfig.nodeEnv,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: { status: 'up' },
    };
  }
}
