import { Test, TestingModule } from '@nestjs/testing';
import { ServiceUnavailableException } from '@nestjs/common';
import { HealthService } from './health.service';
import { AppConfigService } from '../config/app.config';
import { DatabaseHealthService } from '../database/health/database-health.service';

describe('HealthService', () => {
  const createService = async (
    databaseStatus: 'up' | 'down',
  ): Promise<HealthService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HealthService,
        {
          provide: AppConfigService,
          useValue: { nodeEnv: 'test' },
        },
        {
          provide: DatabaseHealthService,
          useValue: {
            check: () => Promise.resolve({ status: databaseStatus }),
          },
        },
      ],
    }).compile();

    return module.get(HealthService);
  };

  it('returns an ok status payload including an "up" database when the database is reachable', async () => {
    const service = await createService('up');
    const status = await service.getStatus();

    expect(status).toMatchObject({
      status: 'ok',
      service: 'capoeira-hub-api',
      environment: 'test',
      database: { status: 'up' },
    });
    expect(typeof status.timestamp).toBe('string');
    expect(typeof status.uptime).toBe('number');
  });

  it('throws a ServiceUnavailableException when the database is down', async () => {
    const service = await createService('down');

    await expect(service.getStatus()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
