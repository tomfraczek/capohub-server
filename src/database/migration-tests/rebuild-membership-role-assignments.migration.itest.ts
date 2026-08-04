/**
 * Integration test for Migration20260804093703_RebuildMembershipRoleAssignments
 * - the Membership/RoleAssignments/Permissions rebuild: Section becomes the
 * only entity with real membership, RoleAssignment becomes independent of
 * any membership relation, and every hard-stop guard that protects
 * disallowed/ambiguous pre-existing data.
 *
 * Every test in this file creates and drops its own throwaway Postgres
 * database (never the shared dev database) - safe to run against a local
 * Postgres instance. Not picked up by the default `npx jest` unit-test run
 * (deliberately named `*.itest.ts`) - run explicitly with:
 *
 *   npm run test:migrations
 *
 * See split-groups-and-sections.migration.itest.ts for why each check opens
 * its own short-lived connection rather than sharing one across the file.
 */
import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmOptions } from '../mikro-orm-options.factory';

jest.setTimeout(60_000);

const BASE_DATABASE_URL = process.env.DATABASE_URL;
const LAST_MIGRATION_BEFORE_REBUILD =
  'Migration20260802100200_AddPolymorphicCommunityReferences';

if (!BASE_DATABASE_URL) {
  throw new Error(
    'rebuild-membership-role-assignments.migration.itest.ts requires DATABASE_URL (see .env) to reach a local Postgres instance for its throwaway test databases.',
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

// Shared fixture ids/seed used by every describe block below - a Root
// Group, two Sections under it, a User, and a legacy group_membership +
// OWNER role_assignment for that Group (always valid, never blocks).
const ROOT_GROUP_ID = 'a0000000-0000-4000-8000-000000000001';
const SECTION_A_ID = 'a0000000-0000-4000-8000-000000000002';
const SECTION_B_ID = 'a0000000-0000-4000-8000-000000000003';
const USER_ID = 'a0000000-0000-4000-8000-000000000004';
const OWNER_MEMBERSHIP_ID = 'a0000000-0000-4000-8000-000000000005';

async function seedBaseFixtures(orm: MikroORM): Promise<void> {
  const connection = orm.em.getConnection();
  await connection.execute(
    `insert into "groups" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
      ('${ROOT_GROUP_ID}', now(), now(), 'Root Group', true, false, false, 'ROOT100', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
  );
  await connection.execute(
    `insert into "sections" (id, created_at, updated_at, parent_group_id, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
      ('${SECTION_A_ID}', now(), now(), '${ROOT_GROUP_ID}', 'Section A', true, false, false, 'SECA100', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
  );
  await connection.execute(
    `insert into "sections" (id, created_at, updated_at, parent_group_id, name, is_public, is_hidden, member_invites_allowed, public_code, status, timezone, currency_code) values
      ('${SECTION_B_ID}', now(), now(), '${ROOT_GROUP_ID}', 'Section B', true, false, false, 'SECB100', 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
  );
  await connection.execute(
    `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
      ('${USER_ID}', now(), now(), 'user_rebuild_itest', 'rebuild-itest@example.com', 'Rebuild Itest User', 'USERI100')`,
  );
  await connection.execute(
    `insert into "group_memberships" (id, created_at, updated_at, root_group_id, user_id, status, joined_at) values
      ('${OWNER_MEMBERSHIP_ID}', now(), now(), '${ROOT_GROUP_ID}', '${USER_ID}', 'ACTIVE', now())`,
  );
  await connection.execute(
    `insert into "role_assignments" (id, created_at, updated_at, membership_id, group_id, role, granted_at) values
      (gen_random_uuid(), now(), now(), '${OWNER_MEMBERSHIP_ID}', '${ROOT_GROUP_ID}', 'OWNER', now())`,
  );
}

describe('Membership/RoleAssignments/Permissions rebuild migration', () => {
  describe('happy path: an unambiguous membership migrates to exactly one Section', () => {
    const dbName = `capohub_migtest_rebuild_happy_${Date.now()}`;
    const memberMembershipId = 'b0000000-0000-4000-8000-000000000001';
    const memberUserId = 'b0000000-0000-4000-8000-000000000002';

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_REBUILD });
        await seedBaseFixtures(orm);
        const connection = orm.em.getConnection();
        await connection.execute(
          `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
            ('${memberUserId}', now(), now(), 'user_rebuild_member', 'rebuild-member@example.com', 'Member User', 'USERI101')`,
        );
        await connection.execute(
          `insert into "group_memberships" (id, created_at, updated_at, root_group_id, user_id, status, joined_at) values
            ('${memberMembershipId}', now(), now(), '${ROOT_GROUP_ID}', '${memberUserId}', 'ACTIVE', now())`,
        );
        // Exactly one distinct Section among this membership's role
        // assignments - the unambiguous, data-derived target.
        await connection.execute(
          `insert into "role_assignments" (id, created_at, updated_at, membership_id, section_id, role, granted_at) values
            (gen_random_uuid(), now(), now(), '${memberMembershipId}', '${SECTION_A_ID}', 'MEMBER', now())`,
        );
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

    it('migrates the membership into section_memberships targeting the single derived Section, id preserved', async () => {
      await withConnection(dbName, async (orm) => {
        const rows = await orm.em
          .getConnection()
          .execute(
            `select id, section_id, user_id, status from "section_memberships" where id = '${memberMembershipId}'`,
          );
        expect(rows).toHaveLength(1);
        expect(rows[0].section_id).toBe(SECTION_A_ID);
        expect(rows[0].user_id).toBe(memberUserId);
        expect(rows[0].status).toBe('ACTIVE');
      });
    });

    it('backfills role_assignments.user_id directly and drops membership_id', async () => {
      await withConnection(dbName, async (orm) => {
        const connection = orm.em.getConnection();
        const columns = await connection.execute(
          `select column_name from information_schema.columns where table_name = 'role_assignments' and column_name = 'membership_id'`,
        );
        expect(columns).toHaveLength(0);

        const rows = await connection.execute(
          `select user_id, granted_by_id, revoked_at from "role_assignments" where section_id = '${SECTION_A_ID}' and role = 'MEMBER'`,
        );
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBe(memberUserId);
        // No historical actor data existed - never invented.
        expect(rows[0].granted_by_id).toBeNull();
        expect(rows[0].revoked_at).toBeNull();
      });
    });

    it('preserves the pre-existing Group OWNER role_assignment, user_id backfilled from its old membership', async () => {
      await withConnection(dbName, async (orm) => {
        const rows = await orm.em
          .getConnection()
          .execute(
            `select user_id, group_id, section_id from "role_assignments" where group_id = '${ROOT_GROUP_ID}' and role = 'OWNER'`,
          );
        expect(rows).toHaveLength(1);
        expect(rows[0].user_id).toBe(USER_ID);
        expect(rows[0].section_id).toBeNull();
      });
    });

    it('rejects a Group-target MEMBER role via the new role_matches_target check constraint', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(
          orm.em.getConnection().execute(`
            insert into "role_assignments" (id, created_at, updated_at, user_id, group_id, role, granted_at)
            values (gen_random_uuid(), now(), now(), '${USER_ID}', '${ROOT_GROUP_ID}', 'MEMBER', now())
          `),
        ).rejects.toThrow();
      });
    });

    it('allows a fresh grant of the same role after the previous one was revoked (partial unique index)', async () => {
      await withConnection(dbName, async (orm) => {
        const connection = orm.em.getConnection();
        const existing = await connection.execute(
          `select id from "role_assignments" where group_id = '${ROOT_GROUP_ID}' and role = 'OWNER'`,
        );
        await connection.execute(
          `update "role_assignments" set revoked_at = now() where id = '${existing[0].id}'`,
        );
        await expect(
          connection.execute(`
            insert into "role_assignments" (id, created_at, updated_at, user_id, group_id, role, granted_at)
            values (gen_random_uuid(), now(), now(), '${memberUserId}', '${ROOT_GROUP_ID}', 'OWNER', now())
          `),
        ).resolves.toBeDefined();
      });
    });

    it('produces no schema diff against entity metadata', async () => {
      await withConnection(dbName, async (orm) => {
        const diff = await orm.schema.getUpdateSchemaSQL();
        expect(diff.trim()).toBe('');
      });
    });
  });

  describe('guard: a Group-target MEMBER/INSTRUCTOR/ASSISTANT role blocks the migration', () => {
    const dbName = `capohub_migtest_rebuild_disallowed_role_${Date.now()}`;

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_REBUILD });
        await seedBaseFixtures(orm);
        // Blocking row: MEMBER held directly on the Group - never valid
        // under the new model, never silently dropped or moved.
        await orm.em.getConnection().execute(
          `insert into "role_assignments" (id, created_at, updated_at, membership_id, group_id, role, granted_at) values
            (gen_random_uuid(), now(), now(), '${OWNER_MEMBERSHIP_ID}', '${ROOT_GROUP_ID}', 'MEMBER', now())`,
        );
      });
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    it('refuses to run and names the blocking row, without dropping group_memberships or touching role_assignments', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(orm.getMigrator().up()).rejects.toThrow(
          /cannot proceed.*Group.*MEMBER\/INSTRUCTOR\/ASSISTANT/s,
        );
      });

      await withConnection(dbName, async (orm) => {
        const connection = orm.em.getConnection();
        const groupMembershipsTable = await connection.execute(
          `select to_regclass('group_memberships') as reg`,
        );
        expect(groupMembershipsTable[0].reg).not.toBeNull();

        const rows: { role: string }[] = await connection.execute(
          `select role from "role_assignments" where group_id = '${ROOT_GROUP_ID}' order by role`,
        );
        expect(rows.map((r) => r.role)).toEqual(['MEMBER', 'OWNER']);

        const executed = await orm.getMigrator().getExecutedMigrations();
        expect(executed.map((m) => m.name)).not.toContain(
          'Migration20260804093703_RebuildMembershipRoleAssignments',
        );
      });
    });
  });

  describe('guard: a membership with zero or multiple Sections blocks the migration', () => {
    const dbName = `capohub_migtest_rebuild_ambiguous_membership_${Date.now()}`;
    const bareMembershipId = 'c0000000-0000-4000-8000-000000000001';
    const bareUserId = 'c0000000-0000-4000-8000-000000000002';
    const multiMembershipId = 'c0000000-0000-4000-8000-000000000003';
    const multiUserId = 'c0000000-0000-4000-8000-000000000004';

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_REBUILD });
        await seedBaseFixtures(orm);
        const connection = orm.em.getConnection();

        // Zero Sections: a bare membership with no role assignments at all.
        await connection.execute(
          `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
            ('${bareUserId}', now(), now(), 'user_rebuild_bare', 'rebuild-bare@example.com', 'Bare User', 'USERI102')`,
        );
        await connection.execute(
          `insert into "group_memberships" (id, created_at, updated_at, root_group_id, user_id, status, joined_at) values
            ('${bareMembershipId}', now(), now(), '${ROOT_GROUP_ID}', '${bareUserId}', 'ACTIVE', now())`,
        );

        // More than one Section: role assignments spread across Section A
        // and Section B for the same membership.
        await connection.execute(
          `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code) values
            ('${multiUserId}', now(), now(), 'user_rebuild_multi', 'rebuild-multi@example.com', 'Multi User', 'USERI103')`,
        );
        await connection.execute(
          `insert into "group_memberships" (id, created_at, updated_at, root_group_id, user_id, status, joined_at) values
            ('${multiMembershipId}', now(), now(), '${ROOT_GROUP_ID}', '${multiUserId}', 'ACTIVE', now())`,
        );
        await connection.execute(
          `insert into "role_assignments" (id, created_at, updated_at, membership_id, section_id, role, granted_at) values
            (gen_random_uuid(), now(), now(), '${multiMembershipId}', '${SECTION_A_ID}', 'MEMBER', now())`,
        );
        await connection.execute(
          `insert into "role_assignments" (id, created_at, updated_at, membership_id, section_id, role, granted_at) values
            (gen_random_uuid(), now(), now(), '${multiMembershipId}', '${SECTION_B_ID}', 'MEMBER', now())`,
        );
      });
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    it('refuses to run and names both blocking memberships, guessing neither', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(orm.getMigrator().up()).rejects.toThrow(
          new RegExp(
            `${bareMembershipId}.*distinct_section_count=0|${bareMembershipId}`,
          ),
        );
      });

      await withConnection(dbName, async (orm) => {
        const executed = await orm.getMigrator().getExecutedMigrations();
        expect(executed.map((m) => m.name)).not.toContain(
          'Migration20260804093703_RebuildMembershipRoleAssignments',
        );
        // Still exactly the seeded group_memberships rows, unmoved.
        const rows = await orm.em
          .getConnection()
          .execute(
            `select id from "group_memberships" where id in ('${bareMembershipId}', '${multiMembershipId}') order by id`,
          );
        expect(rows).toHaveLength(2);
      });
    });
  });

  describe('guard: any existing group_bans row blocks the migration', () => {
    const dbName = `capohub_migtest_rebuild_bans_${Date.now()}`;

    beforeAll(async () => {
      await createDatabase(dbName);
      await withConnection(dbName, async (orm) => {
        await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_REBUILD });
        await seedBaseFixtures(orm);
        await orm.em.getConnection().execute(
          `insert into "group_bans" (id, created_at, updated_at, root_group_id, user_id, banned_at) values
            (gen_random_uuid(), now(), now(), '${ROOT_GROUP_ID}', '${USER_ID}', now())`,
        );
      });
    });

    afterAll(async () => {
      await dropDatabase(dbName);
    });

    it('refuses to run while any group_bans row exists', async () => {
      await withConnection(dbName, async (orm) => {
        await expect(orm.getMigrator().up()).rejects.toThrow(
          /group_bans row\(s\) exist/,
        );
      });
    });
  });
});
