import { Migration } from '@mikro-orm/migrations';

// Career History audit follow-up: FOUNDED_GROUP/STARTED_SECTION were
// re-derived at read time from the earliest-ever RoleAssignment(OWNER) for
// a Group/Section. That RoleAssignment row can be physically deleted -
// UserService.deleteLocalAccountData hard-deletes every RoleAssignment for
// an account being deleted - so a real founder who later transferred
// ownership away and then deleted their CapoHub account would silently
// lose their "founded this" credit to whoever the ownership went to next.
//
// Adds a permanent founder record directly on Group/Section:
// `founder_user_id` (FK, `set null` if that User's account is later
// deleted) and `founder_name_snapshot` (plain string, survives the FK
// going null). `created_at` (already on every entity) doubles as the
// founding date - Group/Section and their founder's OWNER RoleAssignment
// are always created in the same transaction (see GroupsService.create,
// SectionsService.createInternal), so no separate `founded_at` column is
// needed.
//
// --- Backfill strategy for existing rows (revised - see the audit that
// preceded this version) ---
//
// The first version of this migration backfilled from the earliest-ever
// surviving RoleAssignment(OWNER). That is unsound on its own: if the true
// founder transferred ownership away and *then* deleted their account,
// their RoleAssignment row is physically gone (same deletion this whole
// feature exists to stop being invisible), leaving only the successor's
// row to find - "earliest surviving" is not "earliest ever" once a row has
// been deleted. Picking it anyway would bake exactly the false historical
// fact this feature exists to prevent directly into the backfill.
//
// This version prioritizes `audit_log_entries` (action = 'CREATE_COMMUNITY',
// logged exactly once, atomically, by GroupsService.create /
// SectionsService.createInternal - verified: those are the only two call
// sites that ever write this action, both always with a real actor, never
// null at write time) over RoleAssignment entirely:
//
//  1. Exactly one distinct non-null `actor` among a Group/Section's
//     CREATE_COMMUNITY entries (whether there is one such entry, or several
//     that agree - a duplicate-but-agreeing audit trail is not a conflict)
//     -> founder_user_id = that actor, founder_name_snapshot = that User's
//     *current* display_name (read at migration time, same convention as
//     the entity's own comment on why no historical-name field exists
//     elsewhere in this codebase).
//  2. A CREATE_COMMUNITY entry exists but every actor on it is null (the
//     creator's account was deleted - AuditLogEntry.actor is also `set
//     null` on delete, and there is no system-initiated CREATE_COMMUNITY
//     path today to explain a null actor any other way) -> left NULL.
//     Deliberately does NOT fall back to the earliest surviving
//     RoleAssignment(OWNER) here - see the audit above for exactly why
//     that would be a guess dressed up as data.
//  3. No CREATE_COMMUNITY entry exists at all (the row predates audit
//     logging - `audit_log_entries` was added 2026-07-24, after `groups`
//     2026-07-19 and `sections` 2026-07-20 - or was inserted through a path
//     that bypasses GroupsService.create/SectionsService.createInternal
//     entirely, e.g. a test fixture) -> left NULL. No RoleAssignment
//     fallback here either, for the same reason as case 2: an "earliest
//     surviving OWNER" is not evidence of founding, only of current (or
//     past) ownership.
//  4. More than one *distinct non-null* actor among a Group/Section's
//     CREATE_COMMUNITY entries - a genuine, contradictory audit trail
//     (should not happen given the single-call-site write path above, but
//     this migration does not assume that invariant held for every
//     historical row) -> left NULL, and separately flagged via `RAISE
//     NOTICE` (visible in the migration's own output) rather than resolved
//     by picking one arbitrarily.
//
// Never overwrites an already-non-null founder_user_id (every UPDATE below
// is guarded by `... and founder_user_id is null`) - safe to run against a
// database where some rows already have a correct founder recorded, either
// from application writes (a Group/Section created after this migration's
// schema change shipped, which sets founderUser directly at creation - see
// GroupsService.create/SectionsService.createInternal) or from a prior,
// partial run of this same migration.
export class Migration20260923100000_AddGroupSectionFounder extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "founder_user_id" uuid null;`);
    this.addSql(`alter table "groups" add column "founder_name_snapshot" varchar(100) null;`);
    this.addSql(`alter table "groups" add constraint "groups_founder_user_id_foreign" foreign key ("founder_user_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "groups_founder_user_id_index" on "groups" ("founder_user_id");`);

    this.addSql(`alter table "sections" add column "founder_user_id" uuid null;`);
    this.addSql(`alter table "sections" add column "founder_name_snapshot" varchar(100) null;`);
    this.addSql(`alter table "sections" add constraint "sections_founder_user_id_foreign" foreign key ("founder_user_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "sections_founder_user_id_index" on "sections" ("founder_user_id");`);

    // Case 4 (flag, don't guess): surface any Group/Section whose
    // CREATE_COMMUNITY audit trail names more than one distinct actor,
    // before the backfill below silently skips them.
    this.addSql(`
      do $$
      declare
        flagged_groups text;
        flagged_sections text;
      begin
        select string_agg(format('group_id=%s actors=%s', group_id, actors), E'\\n')
        into flagged_groups
        from (
          select "group_id" as group_id,
                 string_agg(distinct coalesce("actor_id"::text, 'NULL'), ', ') as actors
          from "audit_log_entries"
          where "action" = 'CREATE_COMMUNITY' and "group_id" is not null
          group by "group_id"
          having count(distinct "actor_id") > 1
        ) x;

        if flagged_groups is not null then
          raise notice 'Migration20260923100000: Group(s) with conflicting CREATE_COMMUNITY actors - founder left NULL, needs manual review: %', flagged_groups;
        end if;

        select string_agg(format('section_id=%s actors=%s', section_id, actors), E'\\n')
        into flagged_sections
        from (
          select "section_id" as section_id,
                 string_agg(distinct coalesce("actor_id"::text, 'NULL'), ', ') as actors
          from "audit_log_entries"
          where "action" = 'CREATE_COMMUNITY' and "section_id" is not null
          group by "section_id"
          having count(distinct "actor_id") > 1
        ) y;

        if flagged_sections is not null then
          raise notice 'Migration20260923100000: Section(s) with conflicting CREATE_COMMUNITY actors - founder left NULL, needs manual review: %', flagged_sections;
        end if;
      end $$;
    `);

    // Cases 1-3 for Group: backfill only where the audit trail names
    // exactly one distinct actor (`min(actor_id::text)::uuid` recovers that
    // one value - plain `min(uuid)` has no such aggregate in Postgres, and
    // uuid has no natural min/max ordering opinion anyway; text ordering is
    // irrelevant here since there is only ever one distinct value to find.
    // Rows where every actor is null, or where no CREATE_COMMUNITY entry
    // exists at all, simply have no match here and are left untouched).
    this.addSql(`
      with candidate as (
        select "group_id" as gid,
               count(distinct "actor_id") as distinct_actor_count,
               min("actor_id"::text)::uuid as sole_actor_id
        from "audit_log_entries"
        where "action" = 'CREATE_COMMUNITY' and "group_id" is not null
        group by "group_id"
      )
      update "groups" g
      set "founder_user_id" = u."id",
          "founder_name_snapshot" = u."display_name"
      from candidate c
      join "users" u on u."id" = c.sole_actor_id
      where g."id" = c.gid
        and c.distinct_actor_count = 1
        and g."founder_user_id" is null;
    `);

    // Same for Section.
    this.addSql(`
      with candidate as (
        select "section_id" as sid,
               count(distinct "actor_id") as distinct_actor_count,
               min("actor_id"::text)::uuid as sole_actor_id
        from "audit_log_entries"
        where "action" = 'CREATE_COMMUNITY' and "section_id" is not null
        group by "section_id"
      )
      update "sections" s
      set "founder_user_id" = u."id",
          "founder_name_snapshot" = u."display_name"
      from candidate c
      join "users" u on u."id" = c.sole_actor_id
      where s."id" = c.sid
        and c.distinct_actor_count = 1
        and s."founder_user_id" is null;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" drop constraint "groups_founder_user_id_foreign";`);
    this.addSql(`drop index "groups_founder_user_id_index";`);
    this.addSql(`alter table "groups" drop column "founder_user_id";`);
    this.addSql(`alter table "groups" drop column "founder_name_snapshot";`);

    this.addSql(`alter table "sections" drop constraint "sections_founder_user_id_foreign";`);
    this.addSql(`drop index "sections_founder_user_id_index";`);
    this.addSql(`alter table "sections" drop column "founder_user_id";`);
    this.addSql(`alter table "sections" drop column "founder_name_snapshot";`);
  }

}
