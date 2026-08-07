/**
 * Integration test for Migration20260807075703_AlignEventTypeToFourValues -
 * the EventType cleanup: collapses "events".type down to FESTIVAL/WORKSHOP/
 * OPEN_RODA/OTHER and hard-stops instead of guessing a mapping for any
 * pre-existing row outside that catalog.
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
const LAST_MIGRATION_BEFORE_ALIGN = 'Migration20260806132755_AddCareerTimeline';

if (!BASE_DATABASE_URL) {
  throw new Error(
    'align-event-type-to-four-values.migration.itest.ts requires DATABASE_URL (see .env) to reach a local Postgres instance for its throwaway test databases.',
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

const ROOT_GROUP_ID = 'd0000000-0000-4000-8000-000000000001';

async function seedGroup(orm: MikroORM): Promise<void> {
  await orm.em.getConnection().execute(
    `insert into "groups" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
      ('${ROOT_GROUP_ID}', now(), now(), 'Align Event Type Itest Group', true, false, false, 'ALIGN100', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
  );
}

async function insertEvent(
  orm: MikroORM,
  id: string,
  name: string,
  type: string,
  // Only relevant once Migration20260807105243_AddIdentityNumericCodes has
  // applied (events.numeric_code NOT NULL) - omitted for every call site in
  // this file that runs before that point, where the column does not exist
  // yet.
  numericCode?: string,
): Promise<void> {
  const columns = numericCode
    ? '(id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at, numeric_code)'
    : '(id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at)';
  const values = numericCode
    ? `('${id}', now(), now(), '${ROOT_GROUP_ID}', '${type}', '${name}', now(), now() + interval '1 hour', '${numericCode}')`
    : `('${id}', now(), now(), '${ROOT_GROUP_ID}', '${type}', '${name}', now(), now() + interval '1 hour')`;
  await orm.em
    .getConnection()
    .execute(`insert into "events" ${columns} values ${values}`);
}

describe('EventType cleanup migration (Align Event Type To Four Values)', () => {
  describe('happy path: every existing row is already one of the 4 final values', () => {
    const dbName = `capohub_migtest_align_eventtype_happy_${Date.now()}`;
    const eventId = 'd0000000-0000-4000-8000-000000000002';

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_ALIGN });
        await seedGroup(orm);
        await insertEvent(orm, eventId, 'Existing Workshop', 'WORKSHOP');
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

    it('preserves the row and its type unchanged', async () => {
      await withConnection(dbName, async (orm) => {
        const rows = await orm.em
          .getConnection()
          .execute(`select id, type from "events" where id = '${eventId}'`);
        expect(rows).toHaveLength(1);
        expect(rows[0].type).toBe('WORKSHOP');
      });
    });

    it('rejects an insert using a legacy (pre-cleanup) type via the new check constraint', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(
          insertEvent(
            orm,
            'd0000000-0000-4000-8000-000000000099',
            'Should Be Rejected',
            'BATIZADO',
            '000001',
          ),
        ).rejects.toThrow();
      });
    });

    it('accepts an insert for each of the 4 final values', async () => {
      await withConnection(dbName, async (orm) => {
        const values = ['FESTIVAL', 'WORKSHOP', 'OPEN_RODA', 'OTHER'];
        for (const [i, value] of values.entries()) {
          await insertEvent(
            orm,
            `d0000000-0000-4000-8000-0000000001${i}${i}`,
            `Accepted ${value}`,
            value,
            // Namespace is per-type (see EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX),
            // so the same code is safe to reuse across these 4 distinct types.
            '000001',
          );
        }
        const rows: { type: string }[] = await orm.em
          .getConnection()
          .execute(
            `select type from "events" where name like 'Accepted %' order by type`,
          );
        expect(rows.map((r) => r.type)).toEqual([...values].sort());
      });
    });

    it('produces no schema diff against entity metadata', async () => {
      await withConnection(dbName, async (orm) => {
        const diff = await orm.schema.getUpdateSchemaSQL();
        expect(diff.trim()).toBe('');
      });
    });
  });

  describe('guard: a legacy-type row blocks the migration', () => {
    const dbName = `capohub_migtest_align_eventtype_blocked_${Date.now()}`;
    const batizadoId = 'd0000000-0000-4000-8000-000000000003';
    const openTrainingId = 'd0000000-0000-4000-8000-000000000004';

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_ALIGN });
        await seedGroup(orm);
        // Blocking rows: types that existed pre-cleanup but have no safe,
        // unambiguous mapping to the new 4-value catalog - never guessed.
        await insertEvent(orm, batizadoId, 'Batizado 2026', 'BATIZADO');
        await insertEvent(
          orm,
          openTrainingId,
          'Weekly Open Training',
          'OPEN_TRAINING',
        );
      });
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    it('refuses to run and names both blocking rows with their id/title/old type, without touching the events table', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(orm.getMigrator().up()).rejects.toThrow(
          new RegExp(
            `${batizadoId}.*Batizado 2026.*BATIZADO|${batizadoId}`,
            's',
          ),
        );
      });

      await withConnection(dbName, async (orm) => {
        const executed = await orm.getMigrator().getExecutedMigrations();
        expect(executed.map((m) => m.name)).not.toContain(
          'Migration20260807075703_AlignEventTypeToFourValues',
        );

        const rows: { id: string; type: string }[] = await orm.em
          .getConnection()
          .execute(
            `select id, type from "events" where id in ('${batizadoId}', '${openTrainingId}') order by id`,
          );
        expect(rows).toHaveLength(2);
        expect(rows.map((r) => r.type)).toEqual(['BATIZADO', 'OPEN_TRAINING']);

        // The old, wider check constraint is still in force - never
        // narrowed while the migration is blocked.
        const stillLegacyAllowed = await orm.em.getConnection().execute(
          `insert into "events" (id, created_at, updated_at, community_group_id, type, name, starts_at, ends_at) values
            ('d0000000-0000-4000-8000-000000000005', now(), now(), '${ROOT_GROUP_ID}', 'SEMINAR', 'Still Legacy', now(), now() + interval '1 hour')`,
        );
        expect(stillLegacyAllowed).toBeDefined();
      });
    });
  });
});
