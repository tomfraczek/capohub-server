/**
 * Integration test for the Group/Section split migration
 * (Migration20260802100000_SplitGroupsAndSections,
 * Migration20260802100100_DropGroupLocationFields,
 * Migration20260802100200_AddPolymorphicCommunityReferences) and the
 * dual-FK XOR CHECK constraints it introduces.
 *
 * Every test in this file creates and drops its own throwaway Postgres
 * database (never the shared dev database) - safe to run against a local
 * Postgres instance. Not picked up by the default `npx jest` unit-test run
 * (deliberately named `*.itest.ts`, not `*.spec.ts`, since it needs a real
 * local Postgres and is slower than a unit test) - run explicitly with:
 *
 *   npm run test:migrations
 *
 * Each check below opens its own short-lived MikroORM connection rather
 * than sharing one long-lived connection across the whole file - the
 * knex/pg connection pool has been observed to serve a stale
 * pre-migration catalog snapshot to a connection that predates DDL run by
 * a *different* pooled connection earlier in the same process, which has
 * nothing to do with the migration/entities themselves (already verified
 * correct via `mikro-orm migration:up/down` + `schema:update --dump`
 * against real Postgres databases - see the stage-1 migration report).
 * Fresh connections per check side-step that class of pool staleness
 * entirely, at the cost of a little more verbosity here.
 */
import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmOptions } from '../mikro-orm-options.factory';

jest.setTimeout(60_000);

const BASE_DATABASE_URL = process.env.DATABASE_URL;
const LAST_MIGRATION_BEFORE_SPLIT =
  'Migration20260801090000_MakeRecipientGroupNameUniquenessActiveOnly';
// The last of the three split migrations this file tests. Scoping `up()`
// calls to this target (instead of the unqualified "latest") keeps this
// file hermetic as later, unrelated migrations are added to the chain -
// otherwise an unscoped `up()` silently starts exercising whatever
// migration happens to be next, using seed data this file never designed
// for that migration.
const LAST_MIGRATION_OF_SPLIT =
  'Migration20260802100200_AddPolymorphicCommunityReferences';

if (!BASE_DATABASE_URL) {
  throw new Error(
    'split-groups-and-sections.migration.itest.ts requires DATABASE_URL (see .env) to reach a local Postgres instance for its throwaway test databases.',
  );
}

function urlForDatabase(dbName: string): string {
  const url = new URL(BASE_DATABASE_URL!);
  url.pathname = `/${dbName}`;
  return url.toString();
}

/**
 * Uses the compiled dist/ entities/migrations (same as buildMikroOrmOptions
 * gives the running app) rather than entitiesTs/pathTs - this repo has no
 * ts-morph dependency, which entitiesTs discovery requires outside a real
 * ts-node/ts-jest execution context, and MikroORM's migration resolver
 * dynamically `import()`s pathTs's raw `.ts` files directly, bypassing
 * ts-jest's transform entirely (surfaces as "MigrationClass is not a
 * constructor"). `entitiesTs`/`pathTs` are stripped so both entity and
 * migration discovery unambiguously use the compiled dist output.
 * `npm run test:migrations` runs `nest build` first specifically so dist/
 * is guaranteed fresh, rather than depending on whatever an ambient `nest
 * start --watch` happens to have recompiled - see that script in
 * package.json.
 */
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

/**
 * Same as withConnection, but with `migrations` stripped from the config.
 * Reserved for pure database create/drop bootstrapping against the
 * `postgres` maintenance DB - constructing more than one MikroORM instance
 * with `migrations` configured in the same process has been observed to
 * corrupt migration class loading for whichever instance runs second (a
 * MikroORM/umzug quirk, unrelated to this migration's own correctness -
 * see this file's header comment), so the admin connection used only to
 * create/drop a throwaway database never touches that config at all.
 */
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

describe('Group/Section split migration', () => {
  describe('classification and ID preservation (happy path)', () => {
    const dbName = `capohub_migtest_happy_${Date.now()}`;

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        // Migrate to the pre-split baseline first, so these rows represent
        // legacy data the split migration itself must classify - inserting
        // them after a full `up()` would just create them post-split,
        // never exercising the classification logic at all.
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_SPLIT });
        const connection = orm.em.getConnection();
        await connection.execute(
          `insert into "groups" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
            ('11111111-1111-1111-1111-111111111111', now(), now(), 'Root Group', true, false, false, 'ROOT001', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
        );
        await connection.execute(
          `insert into "groups" (id, created_at, updated_at, parent_group_id, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
            ('22222222-2222-2222-2222-222222222222', now(), now(), '11111111-1111-1111-1111-111111111111', 'Former Section (no children)', true, false, false, 'SEC0001', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
        );
        // A minimal user + membership so the "both FKs set"/"only group_id"
        // dual-FK checks below have a real membership_id to attach to,
        // rather than silently inserting zero rows.
        await connection.execute(
          `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
            ('66666666-6666-6666-6666-666666666666', now(), now(), 'user_test_migration_itest', 'migration-itest@example.com', 'Migration Itest User', 'USER0001')`,
        );
        await connection.execute(
          `insert into "group_memberships" (id, created_at, updated_at, root_group_id, user_id, status, joined_at) values
            ('77777777-7777-7777-7777-777777777777', now(), now(), '11111111-1111-1111-1111-111111111111', '66666666-6666-6666-6666-666666666666', 'ACTIVE', now())`,
        );
        await orm.getMigrator().up({ to: LAST_MIGRATION_OF_SPLIT });
      });
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    it('classifies parent_group_id IS NULL as Group, ID preserved', async () => {
      await withConnection(dbName, async (orm) => {
        const rows = await orm.em
          .getConnection()
          .execute(
            `select id, parent_group_id from "groups" where id = '11111111-1111-1111-1111-111111111111'`,
          );
        expect(rows).toHaveLength(1);
        expect(rows[0].parent_group_id).toBeNull();
      });
    });

    it('classifies parent_group_id IS NOT NULL as a former Section, ID preserved', async () => {
      await withConnection(dbName, async (orm) => {
        const connection = orm.em.getConnection();
        const inGroups = await connection.execute(
          `select id from "groups" where id = '22222222-2222-2222-2222-222222222222'`,
        );
        expect(inGroups).toHaveLength(0);

        const inSections = await connection.execute(
          `select id, parent_group_id from "sections" where id = '22222222-2222-2222-2222-222222222222'`,
        );
        expect(inSections).toHaveLength(1);
        expect(inSections[0].parent_group_id).toBe(
          '11111111-1111-1111-1111-111111111111',
        );
      });
    });

    it('rejects a dual-FK row with both group_id and section_id set', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(
          orm.em.getConnection().execute(`
            insert into "role_assignments" (id, created_at, updated_at, membership_id, group_id, section_id, role, granted_at)
            values (gen_random_uuid(), now(), now(), '77777777-7777-7777-7777-777777777777', '11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222', 'MEMBER', now())
          `),
        ).rejects.toThrow();
      });
    });

    it('rejects a dual-FK row with neither group_id nor section_id set', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(
          orm.em.getConnection().execute(`
            insert into "academies" (id, created_at, updated_at, name, status)
            values (gen_random_uuid(), now(), now(), 'No Community Academy', 'ACTIVE')
          `),
        ).rejects.toThrow();
      });
    });

    it('accepts a dual-FK row with only group_id set', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(
          orm.em.getConnection().execute(`
            insert into "academies" (id, created_at, updated_at, group_id, name, status)
            values (gen_random_uuid(), now(), now(), '11111111-1111-1111-1111-111111111111', 'Group Academy', 'ACTIVE')
          `),
        ).resolves.toBeDefined();
      });
    });

    it('accepts a dual-FK row with only section_id set', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(
          orm.em.getConnection().execute(`
            insert into "academies" (id, created_at, updated_at, section_id, name, status)
            values (gen_random_uuid(), now(), now(), '22222222-2222-2222-2222-222222222222', 'Section Academy', 'ACTIVE')
          `),
        ).resolves.toBeDefined();
      });
    });

    it('leaves no pending migrations once every later migration has also run', async () => {
      await withConnection(dbName, async (orm) => {
        // The dual-FK/classification checks above deliberately stop right
        // after the split migrations (they exercise role_assignments while
        // it still has its pre-rebuild `membership_id` column) and have
        // already made full use of the bare `group_memberships` seed row
        // (77777777-...) inserted in beforeAll. That row has no
        // section-targeted role_assignment, which is exactly the ambiguous
        // shape the later rebuild migration's hard-stop correctly refuses
        // to guess about - remove it here so catching up to head below
        // exercises "does head apply cleanly", not that unrelated guard.
        await orm.em
          .getConnection()
          .execute(
            `delete from "group_memberships" where id = '77777777-7777-7777-7777-777777777777'`,
          );
        await orm.getMigrator().up();
        const pending = await orm.getMigrator().getPendingMigrations();
        expect(pending).toHaveLength(0);
      });
    });

    it('produces no schema diff against entity metadata (XOR constraints, public_code, geoname_id all mapped)', async () => {
      await withConnection(dbName, async (orm) => {
        const diff = await orm.schema.getUpdateSchemaSQL();
        expect(diff.trim()).toBe('');
      });
    });
  });

  describe('guard: a former Section with children blocks the migration', () => {
    const dbName = `capohub_migtest_blocked_${Date.now()}`;

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_SPLIT });
        const connection = orm.em.getConnection();
        await connection.execute(
          `insert into "groups" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
            ('33333333-3333-3333-3333-333333333333', now(), now(), 'Root', true, false, false, 'ROOT002', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
        );
        // Blocking row: has a parent (so the old model calls it a Section)
        // AND its own child (so the new model's "Section may never have
        // children" invariant is violated the moment it would land there).
        await connection.execute(
          `insert into "groups" (id, created_at, updated_at, parent_group_id, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
            ('44444444-4444-4444-4444-444444444444', now(), now(), '33333333-3333-3333-3333-333333333333', 'Blocking Former Section', true, false, false, 'SEC0002', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
        );
        await connection.execute(
          `insert into "groups" (id, created_at, updated_at, parent_group_id, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
            ('55555555-5555-5555-5555-555555555555', now(), now(), '44444444-4444-4444-4444-444444444444', 'Child Of Blocking', true, false, false, 'SEC0003', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
        );
      });
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    it('refuses to run and names the blocking row in the error, without creating sections or converting the row to Group', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(orm.getMigrator().up()).rejects.toThrow(
          /Blocking Former Section|44444444-4444-4444-4444-444444444444/,
        );
      });

      await withConnection(dbName, async (orm) => {
        const connection = orm.em.getConnection();
        const sectionsTable = await connection.execute(
          `select to_regclass('sections') as reg`,
        );
        expect(sectionsTable[0].reg).toBeNull();

        // Still exactly the 3 seeded rows, unchanged, still in `groups`.
        const rows = await connection.execute(
          `select id, parent_group_id from "groups" where id in ('33333333-3333-3333-3333-333333333333', '44444444-4444-4444-4444-444444444444', '55555555-5555-5555-5555-555555555555') order by id`,
        );
        expect(rows).toHaveLength(3);

        const executed = await orm.getMigrator().getExecutedMigrations();
        const names = executed.map((m) => m.name);
        expect(names).not.toContain(
          'Migration20260802100000_SplitGroupsAndSections',
        );
      });
    });
  });
});
