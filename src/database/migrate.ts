import { Logger } from '@nestjs/common';
import type { MikroORM as CoreMikroORM } from '@mikro-orm/core';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  DatabaseEnvConfig,
  validateDatabaseEnv,
} from '../config/database-env.schema';
import { buildMikroOrmOptions } from './mikro-orm-options.factory';

/**
 * Migration helpers shared by the two places that apply migrations:
 *
 * - app startup (main.ts): `applyPendingMigrations` on the MikroORM
 *   instance already created by Nest's DatabaseModule, before
 *   `app.listen()` - the normal production path;
 * - this file as a standalone script (`yarn migration:deploy`): a manual
 *   admin tool that applies migrations without starting the HTTP server.
 *   Runs the compiled dist/ code with plain `node` (no ts-node, no CLI) and
 *   deliberately does NOT load .env, so it only sees variables actually set
 *   on the process.
 *
 * Both use the same database env validation (SSL/CA/production guards) and
 * the same MikroORM options factory as the app, and never seed. Pending
 * migrations run in a single transaction (MikroORM's default
 * `allOrNothing`), so a failing migration leaves the schema untouched.
 */

const CONTEXT = 'Migrate';

type MigratorOwner = Pick<CoreMikroORM, 'getMigrator'>;

/**
 * Applies every pending migration; resolves with the applied names (empty
 * when the database is already up to date). Errors propagate unchanged.
 */
export async function applyPendingMigrations(
  orm: MigratorOwner,
): Promise<string[]> {
  const migrator = orm.getMigrator();
  const pending = await migrator.getPendingMigrations();

  if (pending.length === 0) {
    Logger.log('No pending migrations - database is up to date', CONTEXT);
    return [];
  }

  Logger.log(
    `Applying ${pending.length} pending migration(s): ${pending.map((m) => m.name).join(', ')}`,
    CONTEXT,
  );
  const executed = await migrator.up();
  const names = executed.map((m) => m.name);
  Logger.log(`Applied ${names.length} migration(s)`, CONTEXT);
  return names;
}

export async function runPendingMigrations(
  env: DatabaseEnvConfig,
): Promise<string[]> {
  const orm = await MikroORM.init({
    ...buildMikroOrmOptions({
      databaseUrl: env.DATABASE_URL,
      databaseSsl: env.DATABASE_SSL,
      databaseCaCert: env.DATABASE_CA_CERT,
      debug: false,
    }),
    // Always the compiled dist/ entities and migrations, even if a TS
    // loader happens to be registered in this process.
    preferTs: false,
  });

  try {
    return await applyPendingMigrations(orm);
  } finally {
    await orm.close(true);
  }
}

// Driver/TLS errors don't normally echo the connection string, but make
// sure neither it nor its password can ever reach the deploy logs.
export function redactDatabaseUrl(
  message: string,
  databaseUrl?: string,
): string {
  if (!databaseUrl) {
    return message;
  }
  let redacted = message.split(databaseUrl).join('<DATABASE_URL>');
  try {
    const password = decodeURIComponent(new URL(databaseUrl).password);
    if (password) {
      redacted = redacted.split(password).join('*****');
    }
  } catch {
    // Unparseable URL - env validation reports it separately.
  }
  return redacted;
}

/** Log-safe one-line description of a migration/connection failure. */
export function describeMigrationError(
  error: unknown,
  databaseUrl?: string,
): string {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown })?.code;
  const codePrefix =
    typeof code === 'string' || typeof code === 'number' ? `(${code}) ` : '';
  return `${codePrefix}${redactDatabaseUrl(message, databaseUrl)}`;
}

async function bootstrap(): Promise<void> {
  try {
    const env = validateDatabaseEnv(process.env);
    await runPendingMigrations(env);
  } catch (error) {
    Logger.error(
      `Migration run failed: ${describeMigrationError(error, process.env.DATABASE_URL)}`,
      undefined,
      CONTEXT,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void bootstrap();
}
