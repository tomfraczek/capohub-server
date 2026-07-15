import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { buildMikroOrmOptions } from './mikro-orm-options.factory';

const DATABASE_URL = 'postgresql://user:password@localhost:5432/capoeira_hub';

describe('buildMikroOrmOptions', () => {
  it('configures the PostgreSQL driver', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      debug: false,
    });

    expect(options.driver).toBe(PostgreSqlDriver);
  });

  it('passes the client url through without modification', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      debug: false,
    });

    expect(options.clientUrl).toBe(DATABASE_URL);
  });

  it('enables SSL when databaseSsl is true', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: true,
      debug: false,
    });

    expect(options.driverOptions).toEqual({ connection: { ssl: true } });
  });

  it('disables SSL when databaseSsl is false', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      debug: false,
    });

    expect(options.driverOptions).toEqual({ connection: { ssl: false } });
  });

  it('registers the Migrator extension with dedicated ts/js migration paths', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      debug: false,
    });

    expect(options.extensions).toContain(Migrator);
    expect(options.migrations?.path).toBe('./dist/database/migrations');
    expect(options.migrations?.pathTs).toBe('./src/database/migrations');
  });

  it('does not allow global (request-less) EntityManager context', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      debug: false,
    });

    expect(options.allowGlobalContext).toBe(false);
  });

  it('never includes the raw database url outside of clientUrl', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      debug: false,
    });

    const rest: Record<string, unknown> = { ...options };
    delete rest.clientUrl;
    expect(JSON.stringify(rest)).not.toContain(DATABASE_URL);
  });
});
