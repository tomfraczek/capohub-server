import { defineConfig } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';

export interface DatabaseConnectionOptions {
  databaseUrl: string;
  databaseSsl: boolean;
  debug: boolean;
}

/**
 * Single source of truth for the MikroORM options, shared by the Nest
 * DatabaseModule (values sourced from AppConfigService) and by the
 * MikroORM CLI config (values sourced from process.env, see mikro-orm.config.ts).
 * Pure function, no env/IO access, safe to import from unit tests.
 */
export function buildMikroOrmOptions(options: DatabaseConnectionOptions) {
  return defineConfig({
    clientUrl: options.databaseUrl,
    driverOptions: {
      connection: {
        ssl: options.databaseSsl,
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
    // No concrete entity exists yet (BaseEntity is abstract-only); the first
    // one (User) arrives in the next stage. Without this, MikroORM refuses
    // to initialize at all when discovery finds zero concrete entities.
    // TODO: Remove this override once the first concrete entity (User) is added.
    // It is currently disabled only because the project contains BaseEntity only.
    discovery: {
      warnWhenNoEntities: false,
    },
  });
}
