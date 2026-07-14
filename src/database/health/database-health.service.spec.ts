import { Test, TestingModule } from '@nestjs/testing';
import { MikroORM } from '@mikro-orm/core';
import { DatabaseHealthService } from './database-health.service';

describe('DatabaseHealthService', () => {
  const createService = async (
    checkConnection: () => Promise<
      { ok: true } | { ok: false; reason: string }
    >,
  ): Promise<DatabaseHealthService> => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseHealthService,
        {
          provide: MikroORM,
          useValue: {
            em: {
              getConnection: () => ({ checkConnection }),
            },
          },
        },
      ],
    }).compile();

    return module.get(DatabaseHealthService);
  };

  it('reports "up" when the connection check succeeds', async () => {
    const service = await createService(() => Promise.resolve({ ok: true }));

    await expect(service.check()).resolves.toEqual({ status: 'up' });
  });

  it('reports "down" when the connection check fails', async () => {
    const service = await createService(() =>
      Promise.resolve({ ok: false, reason: 'connection refused' }),
    );

    await expect(service.check()).resolves.toEqual({ status: 'down' });
  });

  it('never lets the raw driver error escape check()', async () => {
    const service = await createService(() =>
      Promise.resolve({
        ok: false,
        reason: 'password authentication failed for user "x"',
      }),
    );

    const result = await service.check();
    expect(result).toEqual({ status: 'down' });
    expect(JSON.stringify(result)).not.toContain('password authentication');
  });
});
