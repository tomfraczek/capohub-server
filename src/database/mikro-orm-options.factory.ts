import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

export interface DatabaseConnectionOptions {
  databaseUrl: string;
  databaseSsl: boolean;
  /** PEM CA bundle the server certificate must chain to (see DATABASE_CA_CERT). */
  databaseCaCert?: string;
  debug: boolean;
}

export type DatabaseSslOptions =
  false | { rejectUnauthorized: true; ca?: string };

/**
 * TLS settings handed to node-postgres. When SSL is on, the server
 * certificate is always verified - against `ca` when given (DigitalOcean's
 * per-project CA), otherwise against Node's default trust store. There is
 * deliberately no `rejectUnauthorized: false` path.
 *
 * Note: MikroORM splits `clientUrl` into host/port/user/password/dbName and
 * ignores query parameters such as `?sslmode=require`, so this object is
 * the only thing that decides TLS behaviour.
 */
export function buildSslOptions(
  databaseSsl: boolean,
  databaseCaCert?: string,
): DatabaseSslOptions {
  if (!databaseSsl) {
    return false;
  }
  return databaseCaCert
    ? { rejectUnauthorized: true, ca: databaseCaCert }
    : { rejectUnauthorized: true };
}

/**
 * Single source of truth for the MikroORM options, shared by the Nest
 * DatabaseModule (values sourced from AppConfigService), by the MikroORM
 * CLI config and by the deploy-time migration runner (both sourced from
 * process.env via validateDatabaseEnv, see mikro-orm.config.ts/migrate.ts).
 * Pure function, no env/IO access, safe to import from unit tests.
 */
export function buildMikroOrmOptions(options: DatabaseConnectionOptions) {
  return defineConfig({
    clientUrl: options.databaseUrl,
    driverOptions: {
      connection: {
        ssl: buildSslOptions(options.databaseSsl, options.databaseCaCert),
      },
    },
    entities: ['./dist/**/*.entity.js'],
    entitiesTs: ['./src/**/*.entity.ts'],
    migrations: {
      path: './dist/database/migrations',
      pathTs: './src/database/migrations',
    },
    extensions: [Migrator],
    debug: options.debug,
    allowGlobalContext: false,
  });
}
