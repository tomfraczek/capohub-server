/**
 * Integration test for Migration20260923100000_AddGroupSectionFounder's
 * backfill logic - the strategy that prioritizes AuditLogEntry
 * (action = 'CREATE_COMMUNITY') over RoleAssignment(OWNER), and never
 * falls back to "earliest surviving OWNER" (see that migration's own
 * comment for why: a founder who transferred ownership away and then
 * deleted their account leaves only the successor's RoleAssignment row
 * behind, so "earliest surviving" is not "earliest ever").
 *
 * Every test in this file creates and drops its own throwaway Postgres
 * database (never the shared dev database) - safe to run against a local
 * Postgres instance. Not picked up by the default `npx jest` unit-test run
 * (deliberately named `*.itest.ts`, not `*.spec.ts`) - run explicitly with:
 *
 *   npm run test:migrations
 *
 * Same fresh-connection-per-check convention as
 * split-groups-and-sections.migration.itest.ts (see that file's header for
 * why: a pooled connection has been observed to serve a stale pre-DDL
 * catalog snapshot otherwise).
 */
import 'dotenv/config';
import { MikroORM } from '@mikro-orm/postgresql';
import { buildMikroOrmOptions } from '../mikro-orm-options.factory';

jest.setTimeout(60_000);

const BASE_DATABASE_URL = process.env.DATABASE_URL;
const LAST_MIGRATION_BEFORE_FOUNDER =
  'Migration20260923090000_AddCareerTimelineEventSnapshot';
const FOUNDER_MIGRATION = 'Migration20260923100000_AddGroupSectionFounder';

if (!BASE_DATABASE_URL) {
  throw new Error(
    'add-group-section-founder.migration.itest.ts requires DATABASE_URL (see .env) to reach a local Postgres instance for its throwaway test databases.',
  );
}

function urlForDatabase(dbName: string): string {
  const url = new URL(BASE_DATABASE_URL!);
  url.pathname = `/${dbName}`;
  return url.toString();
}

// Same rationale as split-groups-and-sections.migration.itest.ts's own
// withConnection/withAdminConnection - compiled dist/ entities+migrations,
// and admin (create/drop database) connections never carry `migrations`
// config in the same process as a migrating connection.
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

// --- Seed helpers - raw SQL against the pre-founder-migration schema ------

type Connection = ReturnType<MikroORM['em']['getConnection']>;

async function insertUser(
  connection: Connection,
  id: string,
  displayName: string,
  suffix: string,
): Promise<void> {
  await connection.execute(
    `insert into "users" (id, created_at, updated_at, clerk_user_id, email, display_name, public_code, numeric_code)
     values (?, now(), now(), ?, ?, ?, ?, ?)`,
    [
      id,
      `user_test_${suffix}`,
      `${suffix}@example.com`,
      displayName,
      `USR${suffix}`.slice(0, 15),
      suffix.padStart(6, '0').slice(-6),
    ],
  );
}

async function insertGroup(
  connection: Connection,
  id: string,
  name: string,
  publicCode: string,
): Promise<void> {
  await connection.execute(
    `insert into "groups" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, public_code, status)
     values (?, now(), now(), ?, true, false, false, ?, 'ACTIVE')`,
    [id, name, publicCode],
  );
}

async function insertSection(
  connection: Connection,
  id: string,
  name: string,
): Promise<void> {
  await connection.execute(
    `insert into "sections" (id, created_at, updated_at, name, is_public, is_hidden, member_invites_allowed, status, timezone, currency_code)
     values (?, now(), now(), ?, true, false, false, 'ACTIVE', 'Europe/Warsaw', 'PLN')`,
    [id, name],
  );
}

async function insertOwnerRoleAssignment(
  connection: Connection,
  id: string,
  userId: string,
  target: { groupId?: string; sectionId?: string },
  grantedAt: string,
  revokedAt: string | null = null,
): Promise<void> {
  await connection.execute(
    `insert into "role_assignments" (id, created_at, updated_at, group_id, section_id, role, granted_at, user_id, revoked_at)
     values (?, now(), now(), ?, ?, 'OWNER', ?, ?, ?)`,
    [
      id,
      target.groupId ?? null,
      target.sectionId ?? null,
      grantedAt,
      userId,
      revokedAt,
    ],
  );
}

async function insertCreateCommunityAuditEntry(
  connection: Connection,
  id: string,
  target: { groupId?: string; sectionId?: string },
  actorId: string | null,
): Promise<void> {
  await connection.execute(
    `insert into "audit_log_entries" (id, group_id, section_id, action, actor_id, created_at)
     values (?, ?, ?, 'CREATE_COMMUNITY', ?, now())`,
    [id, target.groupId ?? null, target.sectionId ?? null, actorId],
  );
}

interface FounderRow {
  founder_user_id: string | null;
  founder_name_snapshot: string | null;
}

async function founderOf(
  connection: Connection,
  table: 'groups' | 'sections',
  id: string,
): Promise<FounderRow> {
  const rows = await connection.execute(
    `select founder_user_id, founder_name_snapshot from "${table}" where id = ?`,
    [id],
  );
  return rows[0] as FounderRow;
}

describe('Group/Section founder backfill migration', () => {
  const dbName = `capohub_migtest_founder_${Date.now()}`;

  // Deterministic UUIDs, one octet family per actor/target so failures are
  // readable at a glance.
  const actorMatch = 'a0000000-0000-0000-0000-000000000001';
  const survivingOwnerOnly = 'a0000000-0000-0000-0000-000000000002';
  const survivingOwnerLater = 'a0000000-0000-0000-0000-000000000003';
  const survivingOwnerEarlierNowGone = 'a0000000-0000-0000-0000-000000000004';
  const agreedActor = 'a0000000-0000-0000-0000-000000000005';
  const conflictActorOne = 'a0000000-0000-0000-0000-000000000006';
  const conflictActorTwo = 'a0000000-0000-0000-0000-000000000007';
  const preSetFounder = 'a0000000-0000-0000-0000-000000000008';
  const competingLaterActor = 'a0000000-0000-0000-0000-000000000009';
  const sectionActorMatch = 'a0000000-0000-0000-0000-00000000000a';

  const groupAuditMatch = 'b0000000-0000-0000-0000-000000000001'; // case 1
  const groupAuditNullActor = 'b0000000-0000-0000-0000-000000000002'; // case 2
  const groupNoAuditOneOwner = 'b0000000-0000-0000-0000-000000000003'; // case 3
  const groupNoAuditManyOwners = 'b0000000-0000-0000-0000-000000000004'; // case 4 variant
  const groupAgreeingDuplicateAudit = 'b0000000-0000-0000-0000-000000000005'; // case "zgodne"
  const groupConflictingAudit = 'b0000000-0000-0000-0000-000000000006'; // case "sprzeczne"
  const groupPreSetFounderNotOverwritten =
    'b0000000-0000-0000-0000-000000000007'; // point 7
  const sectionAuditMatch = 'c0000000-0000-0000-0000-000000000001';

  beforeAll(async () => {
    await createDatabase(dbName);
    await withConnection(dbName, async (orm) => {
      // Migrate to the baseline immediately before the founder migration -
      // these rows represent legacy data the backfill itself must classify.
      await orm.getMigrator().up({ to: LAST_MIGRATION_BEFORE_FOUNDER });
      const connection = orm.em.getConnection();

      for (const [id, name, suffix] of [
        [actorMatch, 'Case 1 Actor', 'case1actor'],
        [survivingOwnerOnly, 'Surviving Owner Only', 'survonly'],
        [survivingOwnerLater, 'Surviving Owner Later', 'survlater'],
        [
          survivingOwnerEarlierNowGone,
          'Owner Whose Row Predates Later One',
          'survearlier',
        ],
        [agreedActor, 'Agreed Actor', 'agreed'],
        [conflictActorOne, 'Conflict Actor One', 'conflict1'],
        [conflictActorTwo, 'Conflict Actor Two', 'conflict2'],
        [preSetFounder, 'Pre-Set Founder', 'preset'],
        [competingLaterActor, 'Competing Later Actor', 'competing'],
        [sectionActorMatch, 'Section Case Actor', 'sectcase'],
      ] as const) {
        await insertUser(connection, id, name, suffix);
      }

      // --- Case 1: exactly one CREATE_COMMUNITY entry, non-null actor ----
      await insertGroup(
        connection,
        groupAuditMatch,
        'Audit Match Group',
        'GRPCASE01',
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-000000000001',
        { groupId: groupAuditMatch },
        actorMatch,
      );

      // --- Case 2: CREATE_COMMUNITY exists, actor is NULL (anonymized) ---
      await insertGroup(
        connection,
        groupAuditNullActor,
        'Audit Null Actor Group',
        'GRPCASE02',
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-000000000002',
        { groupId: groupAuditNullActor },
        null,
      );
      // A surviving OWNER also exists (a successor after transfer) - must
      // NOT be picked up as founder just because it is the only one left.
      await insertOwnerRoleAssignment(
        connection,
        'e0000000-0000-0000-0000-000000000002',
        survivingOwnerOnly,
        { groupId: groupAuditNullActor },
        '2024-06-01T00:00:00.000Z',
      );

      // --- Case 3: no CREATE_COMMUNITY at all, exactly one surviving OWNER,
      // ever. This is the corrected behavior - the previous version of this
      // migration would have backfilled from survivingOwnerOnly here.
      await insertGroup(
        connection,
        groupNoAuditOneOwner,
        'No Audit One Owner Group',
        'GRPCASE03',
      );
      await insertOwnerRoleAssignment(
        connection,
        'e0000000-0000-0000-0000-000000000003',
        survivingOwnerOnly,
        { groupId: groupNoAuditOneOwner },
        '2024-01-01T00:00:00.000Z',
      );

      // --- Case 4: no CREATE_COMMUNITY, several distinct OWNER rows across
      // history (an ownership transfer happened) - still no audit signal,
      // so still NULL, regardless of how many candidates RoleAssignment
      // offers.
      await insertGroup(
        connection,
        groupNoAuditManyOwners,
        'No Audit Many Owners Group',
        'GRPCASE04',
      );
      await insertOwnerRoleAssignment(
        connection,
        'e0000000-0000-0000-0000-000000000005',
        survivingOwnerEarlierNowGone,
        { groupId: groupNoAuditManyOwners },
        '2020-01-01T00:00:00.000Z',
        '2022-01-01T00:00:00.000Z', // revoked - ownership transferred away
      );
      await insertOwnerRoleAssignment(
        connection,
        'e0000000-0000-0000-0000-000000000006',
        survivingOwnerLater,
        { groupId: groupNoAuditManyOwners },
        '2022-01-01T00:00:00.000Z',
      );

      // --- "zgodne": two CREATE_COMMUNITY entries that agree on the actor
      // (e.g. a duplicate write) - resolvable, not a conflict.
      await insertGroup(
        connection,
        groupAgreeingDuplicateAudit,
        'Agreeing Duplicate Audit Group',
        'GRPCASE05',
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-000000000007',
        { groupId: groupAgreeingDuplicateAudit },
        agreedActor,
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-000000000008',
        { groupId: groupAgreeingDuplicateAudit },
        agreedActor,
      );

      // --- "sprzeczne": two CREATE_COMMUNITY entries naming two different
      // actors - a genuine contradiction, never resolved by picking one.
      await insertGroup(
        connection,
        groupConflictingAudit,
        'Conflicting Audit Group',
        'GRPCASE06',
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-000000000009',
        { groupId: groupConflictingAudit },
        conflictActorOne,
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-00000000000a',
        { groupId: groupConflictingAudit },
        conflictActorTwo,
      );

      // --- Point 7: founder already set (simulating either an app-created
      // row after the schema change, or a prior partial run of this same
      // migration) - a competing, contradicting CREATE_COMMUNITY entry must
      // not overwrite it.
      await insertGroup(
        connection,
        groupPreSetFounderNotOverwritten,
        'Pre-Set Founder Group',
        'GRPCASE07',
      );
      await connection.execute(
        `update "groups" set "founder_user_id" = ?, "founder_name_snapshot" = ? where id = ?`,
        [preSetFounder, 'Pre-Set Founder', groupPreSetFounderNotOverwritten],
      );
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-00000000000b',
        { groupId: groupPreSetFounderNotOverwritten },
        competingLaterActor,
      );

      // --- Section equivalent of case 1 - proves the backfill identifies
      // the right table/FK column independently for Section.
      await insertSection(connection, sectionAuditMatch, 'Audit Match Section');
      await insertCreateCommunityAuditEntry(
        connection,
        'd0000000-0000-0000-0000-00000000000c',
        { sectionId: sectionAuditMatch },
        sectionActorMatch,
      );

      await orm.getMigrator().up({ to: FOUNDER_MIGRATION });
    });
  });

  afterAll(async () => {
    await dropDatabase(dbName);
  });

  it('case 1: backfills founderUser + a current-displayName snapshot from a single, unambiguous CREATE_COMMUNITY actor', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupAuditMatch,
      );
      expect(founder.founder_user_id).toBe(actorMatch);
      expect(founder.founder_name_snapshot).toBe('Case 1 Actor');
    });
  });

  it('case 2: leaves founderUser NULL when the CREATE_COMMUNITY actor was anonymized (account deleted), even though a surviving OWNER exists', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupAuditNullActor,
      );
      expect(founder.founder_user_id).toBeNull();
      expect(founder.founder_name_snapshot).toBeNull();
    });
  });

  it('case 3: leaves founderUser NULL with no CREATE_COMMUNITY entry, even with exactly one surviving OWNER ever - the corrected behavior (no more earliest-OWNER fallback)', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupNoAuditOneOwner,
      );
      expect(founder.founder_user_id).toBeNull();
      expect(founder.founder_name_snapshot).toBeNull();
    });
  });

  it('case 4: leaves founderUser NULL with no CREATE_COMMUNITY entry and several distinct OWNER rows across history (a transfer happened, with zero audit signal)', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupNoAuditManyOwners,
      );
      expect(founder.founder_user_id).toBeNull();
      expect(founder.founder_name_snapshot).toBeNull();
    });
  });

  it('zgodne dane: two CREATE_COMMUNITY entries agreeing on the same actor resolve to that actor, not treated as a conflict', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupAgreeingDuplicateAudit,
      );
      expect(founder.founder_user_id).toBe(agreedActor);
      expect(founder.founder_name_snapshot).toBe('Agreed Actor');
    });
  });

  it('sprzeczne dane: two CREATE_COMMUNITY entries naming different actors leave founderUser NULL rather than picking one arbitrarily', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupConflictingAudit,
      );
      expect(founder.founder_user_id).toBeNull();
      expect(founder.founder_name_snapshot).toBeNull();
    });
  });

  it('never overwrites an already-set founderUser, even when a CREATE_COMMUNITY entry names a different actor', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'groups',
        groupPreSetFounderNotOverwritten,
      );
      expect(founder.founder_user_id).toBe(preSetFounder);
      expect(founder.founder_name_snapshot).toBe('Pre-Set Founder');
    });
  });

  it('identifies the correct object for Section independently of Group (via section_id, not group_id)', async () => {
    await withConnection(dbName, async (orm) => {
      const founder = await founderOf(
        orm.em.getConnection(),
        'sections',
        sectionAuditMatch,
      );
      expect(founder.founder_user_id).toBe(sectionActorMatch);
      expect(founder.founder_name_snapshot).toBe('Section Case Actor');
    });
  });

  it('leaves no pending migrations once every later migration has also run', async () => {
    await withConnection(dbName, async (orm) => {
      await orm.getMigrator().up();
      const pending = await orm.getMigrator().getPendingMigrations();
      expect(pending).toHaveLength(0);
    });
  });
});
