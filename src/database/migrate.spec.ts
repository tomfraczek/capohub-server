import { Logger } from '@nestjs/common';
import {
  applyPendingMigrations,
  describeMigrationError,
  redactDatabaseUrl,
} from './migrate';

const DATABASE_URL =
  'postgresql://doadmin:s3cr%40t-pass@db-capohub.example.invalid:25060/defaultdb?sslmode=require';

function ormWithMigrator(migrator: {
  getPendingMigrations: jest.Mock;
  up: jest.Mock;
}) {
  return { getMigrator: () => migrator } as unknown as Parameters<
    typeof applyPendingMigrations
  >[0];
}

describe('applyPendingMigrations', () => {
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    logSpy = jest.spyOn(Logger, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('does not call up() and resolves empty when nothing is pending', async () => {
    const migrator = {
      getPendingMigrations: jest.fn().mockResolvedValue([]),
      up: jest.fn(),
    };

    await expect(
      applyPendingMigrations(ormWithMigrator(migrator)),
    ).resolves.toEqual([]);
    expect(migrator.up).not.toHaveBeenCalled();
    expect(logSpy).toHaveBeenCalledWith(
      'No pending migrations - database is up to date',
      'Migrate',
    );
  });

  it('applies pending migrations and resolves with the applied names', async () => {
    const migrator = {
      getPendingMigrations: jest
        .fn()
        .mockResolvedValue([{ name: 'MigrationA' }, { name: 'MigrationB' }]),
      up: jest
        .fn()
        .mockResolvedValue([{ name: 'MigrationA' }, { name: 'MigrationB' }]),
    };

    await expect(
      applyPendingMigrations(ormWithMigrator(migrator)),
    ).resolves.toEqual(['MigrationA', 'MigrationB']);
    expect(migrator.up).toHaveBeenCalledTimes(1);
    expect(logSpy).toHaveBeenCalledWith(
      'Applying 2 pending migration(s): MigrationA, MigrationB',
      'Migrate',
    );
  });

  it('propagates a migration failure', async () => {
    const failure = new Error('relation "x" already exists');
    const migrator = {
      getPendingMigrations: jest.fn().mockResolvedValue([{ name: 'M1' }]),
      up: jest.fn().mockRejectedValue(failure),
    };

    await expect(
      applyPendingMigrations(ormWithMigrator(migrator)),
    ).rejects.toBe(failure);
  });

  it('propagates a failure to read the pending list (e.g. connection lost)', async () => {
    const failure = new Error('Connection terminated unexpectedly');
    const migrator = {
      getPendingMigrations: jest.fn().mockRejectedValue(failure),
      up: jest.fn(),
    };

    await expect(
      applyPendingMigrations(ormWithMigrator(migrator)),
    ).rejects.toBe(failure);
    expect(migrator.up).not.toHaveBeenCalled();
  });
});

describe('describeMigrationError', () => {
  it('prefixes the driver error code and redacts secrets', () => {
    const error = Object.assign(
      new Error(`password authentication failed for ${DATABASE_URL}`),
      { code: '28P01' },
    );

    expect(describeMigrationError(error, DATABASE_URL)).toBe(
      '(28P01) password authentication failed for <DATABASE_URL>',
    );
  });

  it('handles errors without a code and non-Error values', () => {
    expect(describeMigrationError(new Error('boom'), DATABASE_URL)).toBe(
      'boom',
    );
    expect(describeMigrationError('plain string', undefined)).toBe(
      'plain string',
    );
  });
});

describe('redactDatabaseUrl', () => {
  it('replaces the full connection string', () => {
    expect(
      redactDatabaseUrl(`failed to connect to ${DATABASE_URL}`, DATABASE_URL),
    ).toBe('failed to connect to <DATABASE_URL>');
  });

  it('masks the (decoded) password wherever it appears', () => {
    expect(
      redactDatabaseUrl('auth failed for password s3cr@t-pass', DATABASE_URL),
    ).toBe('auth failed for password *****');
  });

  it('leaves messages without secrets untouched', () => {
    expect(
      redactDatabaseUrl(
        'self-signed certificate in certificate chain',
        DATABASE_URL,
      ),
    ).toBe('self-signed certificate in certificate chain');
  });

  it('is a no-op without a DATABASE_URL', () => {
    expect(redactDatabaseUrl('boom', undefined)).toBe('boom');
  });
});
