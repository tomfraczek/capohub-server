import { Logger } from '@nestjs/common';
import { MikroORM } from '@mikro-orm/postgresql';
import {
  DatabaseEnvConfig,
  validateDatabaseEnv,
} from '../config/database-env.schema';
import { buildMikroOrmOptions } from './mikro-orm-options.factory';

/**
 * Deploy-time migration runner - the DigitalOcean App Platform PRE_DEPLOY
 * job's command (`yarn migration:deploy`, see docs/digitalocean-production.md).
 *
 * Runs the compiled migrations in dist/ with plain `node`: no ts-node, no
 * Nest/MikroORM CLI, so it works after the buildpack prunes devDependencies.
 * Deliberately does NOT load .env - it only ever sees variables actually
 * set on the process, so a local run cannot silently pick up a developer
 * .env. Uses the same database env validation (SSL/CA/production guards)
 * and the same MikroORM options factory as the app. Never seeds.
 *
 * Idempotent: with nothing pending it exits 0. Any failure exits 1, which
 * makes App Platform abort the deployment before the new version starts.
 * Pending migrations run in a single transaction (MikroORM's default
 * `allOrNothing`), so a failing migration leaves the schema untouched.
 */

const CONTEXT = 'Migrate';

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

async function bootstrap(): Promise<void> {
  try {
    const env = validateDatabaseEnv(process.env);
    await runPendingMigrations(env);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = (error as { code?: unknown })?.code;
    const codeSuffix =
      typeof code === 'string' || typeof code === 'number' ? ` (${code})` : '';
    Logger.error(
      `Migration run failed${codeSuffix}: ${redactDatabaseUrl(message, process.env.DATABASE_URL)}`,
      undefined,
      CONTEXT,
    );
    process.exitCode = 1;
  }
}

if (require.main === module) {
  void bootstrap();
}
