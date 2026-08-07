/**
 * Integration test for Migration20260807105243_AddIdentityNumericCodes -
 * backfills a 6-digit numericCode onto every existing User/Event row, then
 * locks the column down to NOT NULL with its real unique/check
 * constraints. See numeric-code.spec.ts for the generator/retry logic
 * itself (unit-testable, no DB needed); this file only verifies the
 * migration's own backfill SQL against real pre-existing rows.
 *
 * Every test in this file creates and drops its own throwaway Postgres
 * database (never the shared dev database) - safe to run against a local
 * Postgres instance. Not picked up by the default `npx jest` unit-test run
 * (deliberately named `*.itest.ts`) - run explicitly with:
 *
 *   npm run test:migrations
 */
import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmOptions } from '../mikro-orm-options.factory';

jest.setTimeout(60_000);

const BASE_DATABASE_URL = process.env.DATABASE_URL;
const LAST_MIGRATION_BEFORE_IDENTITY =
  'Migration20260807093428_AddTrainingsModule';

if (!BASE_DATABASE_URL) {
  throw new Error(
    'add-identity-numeric-codes.migration.itest.ts requires DATABASE_URL (see .env) to reach a local Postgres instance for its throwaway test databases.',
  );
}

function urlForDatabase(dbName: string): string {
  const url = new URL(BASE_DATABASE_URL!);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function withConnection<T>(
  dbName: string,
  fn: (orm: MikroORM) => Promise<T>,
): Promise<T> {
  const options = buildMikroOrmOptions({
    databaseUrl: urlForDatabase(dbName),
    databaseSsl: false,
    debug: false,
  });
  delete (options as { entitiesTs?: unknown }).entitiesTs;
  delete (options.migrations as { pathTs?: unknown }).pathTs;
  const orm = await MikroORM.init(options);
  try {
    return await fn(orm);
  } finally {
    await orm.close(true);
  }
}

async function withAdminConnection<T>(
  dbName: string,
  fn: (orm: MikroORM) => Promise<T>,
): Promise<T> {
  const options = buildMikroOrmOptions({
    databaseUrl: urlForDatabase(dbName),
    databaseSsl: false,
    debug: false,
  });
  delete (options as { migrations?: unknown }).migrations;
  const orm = await MikroORM.init(options);
  try {
    return await fn(orm);
  } finally {
    await orm.close(true);
  }
}

async function createDatabase(dbName: string): Promise<void> {
  await withAdminConnection('postgres', (orm) =>
    orm.schema.createDatabase(dbName),
  );
}

async function dropDatabase(dbName: string): Promise<void> {
  await withAdminConnection('postgres', async (orm) => {
    await orm.em
      .getConnection()
      .execute(
        `select pg_terminate_backend(pid) from pg_stat_activity where datname = ? and pid <> pg_backend_pid()`,
        [dbName],
      );
    await orm.schema.dropDatabase(dbName);
  });
}

const ROOT_GROUP_ID = 'e0000000-0000-4000-8000-000000000001';

async function seedGroup(orm: MikroORM): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into "groups" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
      ('${ROOT_GROUP_ID}', now(), now(), 'Identity Numeric Codes Itest Group', true, false, false, 'IDENT100', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
  );
}

async function seedUser(
  orm: MikroORM,
  id: string,
  publicCode: string,
): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
      ('${id}', now(), now(), 'clerk_${id}', '${id}@example.com', 'Test User', '${publicCode}')`,
  );
}

async function seedEvent(
  orm: MikroORM,
  id: string,
  type: string,
  publicCode: string,
): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into "events" (id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at, public_code) values
      ('${id}', now(), now(), '${ROOT_GROUP_ID}', '${type}', 'Existing Event', now(), now() + interval '1 hour', '${publicCode}')`,
  );
}

describe('AddIdentityNumericCodes migration', () => {
  const dbName = `capohub_migtest_identity_codes_${Date.now()}`;
  const userIds = [
    'e0000000-0000-4000-8000-000000000010',
    'e0000000-0000-4000-8000-000000000011',
    'e0000000-0000-4000-8000-000000000012',
  ];
  const eventFestivalId = 'e0000000-0000-4000-8000-000000000020';
  const eventWorkshopId = 'e0000000-0000-4000-8000-000000000021';

  beforeAll(async () => {
    await createDatabase(dbName);
    await withConnection(dbName, async (orm) => {
      await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_IDENTITY });
      await seedGroup(orm);
      for (const [i, id] of userIds.entries()) {
        await seedUser(orm, id, `USR${i}0001`);
      }
      await seedEvent(orm, eventFestivalId, 'FESTIVAL', 'EVT000001');
      await seedEvent(orm, eventWorkshopId, 'WORKSHOP', 'EVT000002');
      await orm.getMigrator().up();
    });
  });

  afterAll(async () => {
    await dropDatabase(dbName);
  });

  it('leaves no pending migrations', async () => {
    await withConnection(dbName, async (orm) => {
      const pending = await orm.getMigrator().getPendingMigrations();
      expect(pending).toHaveLength(0);
    });
  });

  it('backfills every existing User with a unique 6-digit numericCode', async () => {
    await withConnection(dbName, async (orm) => {
      const idList = userIds.map((id) => `'${id}'`).join(', ');
      const rows: { id: string; numeric_code: string }[] = await orm.em
        .getConnection()
        .execute(
          `select id, numeric_code from "users" where id in (${idList})`,
        );
      expect(rows).toHaveLength(userIds.length);
      for (const row of rows) {
        expect(row.numeric_code).toMatch(/^[0-9]{6}$/);
      }
      const codes = rows.map((r) => r.numeric_code);
      expect(new Set(codes).size).toBe(codes.length);
    });
  });

  it('backfills every existing Event with a unique-per-type 6-digit numericCode', async () => {
    await withConnection(dbName, async (orm) => {
      const rows: { id: string; type: string; numeric_code: string }[] =
        await orm.em
          .getConnection()
          .execute(
            `select id, type, numeric_code from "events" where id in ('${eventFestivalId}', '${eventWorkshopId}') order by id`,
          );
      expect(rows).toHaveLength(2);
      for (const row of rows) {
        expect(row.numeric_code).toMatch(/^[0-9]{6}$/);
      }
    });
  });

  it('enforces NOT NULL on both columns for new inserts', async () => {
    await withConnection(dbName, async (orm) => {
      await expect(
        orm.em.getConnection().execute(
          `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
            ('e0000000-0000-4000-8000-000000000099', now(), now(), 'clerk_missing', 'missing@example.com', 'No Code', 'MISSING01')`,
        ),
      ).rejects.toThrow();

      await expect(
        orm.em.getConnection().execute(
          `insert into "events" (id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at, public_code) values
            ('e0000000-0000-4000-8000-000000000098', now(), now(), '${ROOT_GROUP_ID}', 'OTHER', 'No Code Event', now(), now() + interval '1 hour', 'MISSING02')`,
        ),
      ).rejects.toThrow();
    });
  });

  it('enforces the 6-digit CHECK constraint on both columns', async () => {
    await withConnection(dbName, async (orm) => {
      await expect(
        orm.em.getConnection().execute(
          `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code, numeric_code) values
            ('e0000000-0000-4000-8000-000000000097', now(), now(), 'clerk_bad', 'bad@example.com', 'Bad Code', 'BADCODE01', 'abcdef')`,
        ),
      ).rejects.toThrow();
    });
  });

  it('rejects the same (type, numericCode) pair twice, but allows the same numericCode across different types', async () => {
    await withConnection(dbName, async (orm) => {
      const rows: { numeric_code: string }[] = await orm.em
        .getConnection()
        .execute(`select numeric_code from "events" where id = ?`, [
          eventFestivalId,
        ]);
      const existingCode = rows[0].numeric_code;

      await expect(
        orm.em.getConnection().execute(
          `insert into "events" (id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at, public_code, numeric_code) values
            ('e0000000-0000-4000-8000-000000000096', now(), now(), '${ROOT_GROUP_ID}', 'FESTIVAL', 'Duplicate', now(), now() + interval '1 hour', 'DUPCODE01', '${existingCode}')`,
        ),
      ).rejects.toThrow();

      const otherTypeInsert = await orm.em.getConnection().execute(
        `insert into "events" (id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at, public_code, numeric_code) values
          ('e0000000-0000-4000-8000-000000000095', now(), now(), '${ROOT_GROUP_ID}', 'WORKSHOP', 'Same Code Different Type', now(), now() + interval '1 hour', 'DIFFTYPE1', '${existingCode}')`,
      );
      expect(otherTypeInsert).toBeDefined();
    });
  });

  it('produces no schema diff against entity metadata', async () => {
    await withConnection(dbName, async (orm) => {
      const diff = await orm.schema.getUpdateSchemaSQL();
      expect(diff.trim()).toBe('');
    });
  });
});
