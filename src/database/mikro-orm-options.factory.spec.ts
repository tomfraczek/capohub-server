import { PostgreSqlDriver } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { TEST_DATABASE_CA_CERT } from '../../test/database-ca-cert.fixture';
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

  it('enables verified SSL against the default trust store when no CA is given', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: true,
      debug: false,
    });

    expect(options.driverOptions).toEqual({
      connection: { ssl: { rejectUnauthorized: true } },
    });
  });

  it('passes the CA certificate through with certificate verification on', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: true,
      databaseCaCert: TEST_DATABASE_CA_CERT,
      debug: false,
    });

    expect(options.driverOptions).toEqual({
      connection: {
        ssl: { rejectUnauthorized: true, ca: TEST_DATABASE_CA_CERT },
      },
    });
  });

  it('ignores the CA certificate when SSL is disabled', () => {
    const options = buildMikroOrmOptions({
      databaseUrl: DATABASE_URL,
      databaseSsl: false,
      databaseCaCert: TEST_DATABASE_CA_CERT,
      debug: false,
    });

    expect(options.driverOptions).toEqual({ connection: { ssl: false } });
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
