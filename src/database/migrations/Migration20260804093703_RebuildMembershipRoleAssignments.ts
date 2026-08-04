import { Migration } from '@mikro-orm/migrations';

// Stage 2 of the organizational-domain rebuild: retargets membership from
// "the Root Group" to "a Section" (Group has no membership at all from now
// on), and makes RoleAssignment independent of any membership relation -
// granted directly to a user, for exactly one Group or Section, with its
// own soft-revoke lifecycle (revoked_at/revoked_by) that lets a Section
// membership be left and rejoined without a historical additional Role
// silently regaining authority.
//
// Every row this migration touches is reinterpreted strictly by data that
// already exists - never guessed from name/city/usage:
//   - A `group_memberships` row can only become a `section_memberships`
//     row if its own `role_assignments` point at *exactly one* distinct
//     Section - that Section is then the unambiguous, data-derived
//     target. Zero Sections (nothing to attach to) or more than one
//     (which one?) both count as ambiguous.
//   - A `role_assignments` row with `group_id` set and role IN
//     ('MEMBER','INSTRUCTOR','ASSISTANT') is invalid under the new model
//     (Group only ever allows OWNER/ADMIN) and has no safe automatic
//     destination - it is never silently deleted or moved to a guessed
//     Section.
//   - `group_bans` / `community_notification_settings` have no
//     Section-hinting data at all (no role assignments to inspect) - any
//     existing row blocks this migration outright rather than being
//     dropped or guessed at.
//
// Every hard-stop below names the exact blocking row(s) so an operator can
// resolve them by hand (create the missing Section and grant the correct
// Role first, or remove genuinely disposable dev/test data with explicit
// approval) and re-run - this migration will not decide that for them.
export class Migration20260804093703_RebuildMembershipRoleAssignments extends Migration {
  override async up(): Promise<void> {
    // ---- Hard stop 1: Group-target MEMBER/INSTRUCTOR/ASSISTANT ----
    // Group only ever allows OWNER/ADMIN from now on (see
    // role_assignments_role_matches_target_check below). A pre-existing
    // Group-target MEMBER/INSTRUCTOR/ASSISTANT row is not silently
    // dropped or reassigned - it blocks the migration until resolved.
    this.addSql(`
      do $$
      declare
        blocked text;
      begin
        select string_agg(
          format(
            'role_assignment_id=%s membership_id=%s group_id=%s role=%s',
            ra.id, ra.membership_id, ra.group_id, ra.role
          ),
          e'\\n'
        )
        into blocked
        from "role_assignments" ra
        where ra."group_id" is not null
          and ra."role" in ('MEMBER', 'INSTRUCTOR', 'ASSISTANT');

        if blocked is not null then
          raise exception e'Migration20260804093703_RebuildMembershipRoleAssignments: cannot proceed - the following role_assignments row(s) target a Group with a role that only a Section may hold (MEMBER/INSTRUCTOR/ASSISTANT). Group only allows OWNER/ADMIN under the new model. This migration will not silently delete these rows or move them to a guessed Section. Resolve manually (create the correct Section and re-grant the role there, or remove the row with explicit approval) and re-run.\\n%', blocked;
        end if;
      end $$;
    `);

    // ---- Hard stop 2: group_memberships that cannot map to exactly one Section ----
    // A membership becomes a SectionMembership only when its own
    // role_assignments point at exactly one distinct Section. A membership
    // whose role_assignments point at more than one distinct Section is
    // ambiguous (which one?) and blocks the migration. A membership with
    // zero Section-targeted role_assignments is only ambiguous if it also
    // has no Group-targeted role_assignment to explain its existence
    // (nothing at all to attach it to, in either direction) - if it *does*
    // carry a Group-targeted role (OWNER/ADMIN, already handled
    // losslessly below), the membership row itself simply never becomes a
    // SectionMembership and is dropped once every dependent FK has moved
    // off it. Never guessed from the membership's Root Group, name, or any
    // other hint.
    this.addSql(`
      do $$
      declare
        blocked text;
      begin
        select string_agg(
          format(
            'group_membership_id=%s root_group_id=%s user_id=%s status=%s distinct_section_count=%s has_group_role=%s',
            gm.id, gm.root_group_id, gm.user_id, gm.status,
            (select count(distinct ra.section_id) from "role_assignments" ra where ra.membership_id = gm.id and ra.section_id is not null),
            exists (select 1 from "role_assignments" ra where ra.membership_id = gm.id and ra.group_id is not null)
          ),
          e'\\n'
        )
        into blocked
        from "group_memberships" gm
        where (
          select count(distinct ra.section_id)
          from "role_assignments" ra
          where ra.membership_id = gm.id and ra.section_id is not null
        ) > 1
        or (
          (
            select count(distinct ra.section_id)
            from "role_assignments" ra
            where ra.membership_id = gm.id and ra.section_id is not null
          ) = 0
          and not exists (
            select 1 from "role_assignments" ra
            where ra.membership_id = gm.id and ra.group_id is not null
          )
        );

        if blocked is not null then
          raise exception e'Migration20260804093703_RebuildMembershipRoleAssignments: cannot proceed - the following group_memberships row(s) cannot be unambiguously mapped to exactly one Section from their own role_assignments (0 with no Group role either = nothing to attach it to, >1 = which one?). This migration will never guess a Section from the membership''s Root Group, name, or parent. Resolve manually per row (grant a Role for the single correct Section first, or leave/remove the row with explicit approval) and re-run.\\n%', blocked;
        end if;
      end $$;
    `);

    // ---- Hard stop 3: group_bans / community_notification_settings ----
    // Both are Root-Group-scoped today with no Section-hinting data
    // attached at all (no role assignments to inspect) - there is no safe
    // automatic destination, so any existing row blocks this migration.
    this.addSql(`
      do $$
      declare
        blocked text;
      begin
        select string_agg(
          format('group_ban_id=%s root_group_id=%s user_id=%s', gb.id, gb.root_group_id, gb.user_id),
          e'\\n'
        )
        into blocked
        from "group_bans" gb;

        if blocked is not null then
          raise exception e'Migration20260804093703_RebuildMembershipRoleAssignments: cannot proceed - the following group_bans row(s) exist and cannot be unambiguously mapped to a Section (a ban has no role-assignment data to derive one from). Resolve manually (re-create the ban against the correct Section after this migration, or remove the row with explicit approval) and re-run.\\n%', blocked;
        end if;
      end $$;
    `);
    this.addSql(`
      do $$
      declare
        blocked text;
      begin
        select string_agg(
          format('community_notification_settings_id=%s community_id=%s user_id=%s', s.id, s.community_id, s.user_id),
          e'\\n'
        )
        into blocked
        from "community_notification_settings" s;

        if blocked is not null then
          raise exception e'Migration20260804093703_RebuildMembershipRoleAssignments: cannot proceed - the following community_notification_settings row(s) exist and cannot be unambiguously mapped to a Section. Resolve manually (the user can re-create their preferences against the correct Section after this migration, or remove the row with explicit approval) and re-run.\\n%', blocked;
        end if;
      end $$;
    `);

    // ================================================================
    // From here on, every hard stop above has passed - the remaining
    // steps are deterministic, lossless transformations of already-valid
    // data.
    // ================================================================

    // ---- section_memberships (new table) ----
    this.addSql(`
      create table "section_memberships" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "section_id" uuid not null,
        "user_id" uuid not null,
        "status" text check ("status" in ('INVITED', 'ACTIVE', 'READ_ONLY', 'ARCHIVED')) not null default 'ACTIVE',
        "joined_at" timestamptz not null,
        "left_at" timestamptz null,
        "end_reason" text check ("end_reason" in ('LEFT', 'REMOVED', 'BANNED')) null,
        "ended_by_id" uuid null,
        constraint "section_memberships_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "section_memberships_section_id_index" on "section_memberships" ("section_id");`,
    );
    this.addSql(
      `create index "section_memberships_user_id_index" on "section_memberships" ("user_id");`,
    );
    this.addSql(
      `create index "section_memberships_section_id_user_id_status_index" on "section_memberships" ("section_id", "user_id", "status");`,
    );
    this.addSql(`
      create unique index "section_memberships_section_id_user_id_active_unique"
        on "section_memberships" ("section_id", "user_id") where ("status" = 'ACTIVE');
    `);
    this.addSql(`
      alter table "section_memberships" add constraint "section_memberships_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "section_memberships" add constraint "section_memberships_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "section_memberships" add constraint "section_memberships_ended_by_id_foreign"
        foreign key ("ended_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // Every remaining group_memberships row with at least one
    // Section-targeted role_assignment has, by hard stop 2 above, exactly
    // one distinct Section among them - that Section is the unambiguous
    // target. A row with none (only a Group-targeted OWNER/ADMIN role, or
    // no role at all - both already validated safe above) simply has no
    // SectionMembership to become and is excluded here; its
    // Group-targeted role_assignment (if any) is preserved independently
    // below. id/timestamps/status/lifecycle fields are preserved verbatim;
    // ended_by_id has no historical actor data to backfill and is left
    // null (a correct, documented historical value - see
    // SectionMembership.endedBy's own comment).
    this.addSql(`
      insert into "section_memberships"
        ("id", "created_at", "updated_at", "section_id", "user_id", "status", "joined_at", "left_at", "end_reason", "ended_by_id")
      select
        gm."id", gm."created_at", gm."updated_at",
        (select ra."section_id" from "role_assignments" ra where ra."membership_id" = gm."id" and ra."section_id" is not null limit 1),
        gm."user_id", gm."status", gm."joined_at", gm."left_at", gm."end_reason", null
      from "group_memberships" gm
      where exists (
        select 1 from "role_assignments" ra
        where ra."membership_id" = gm."id" and ra."section_id" is not null
      );
    `);

    // ---- role_assignments: user_id direct, grantedBy/revokedAt/revokedBy ----
    this.addSql(`alter table "role_assignments" add column "user_id" uuid null;`);
    this.addSql(`
      update "role_assignments" ra set "user_id" = gm."user_id"
      from "group_memberships" gm
      where ra."membership_id" = gm."id";
    `);
    this.addSql(`alter table "role_assignments" alter column "user_id" set not null;`);
    this.addSql(
      `create index "role_assignments_user_id_index" on "role_assignments" ("user_id");`,
    );
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);

    this.addSql(`alter table "role_assignments" add column "granted_by_id" uuid null;`);
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_granted_by_id_foreign"
        foreign key ("granted_by_id") references "users" ("id") on update cascade on delete set null;
    `);
    this.addSql(`alter table "role_assignments" add column "revoked_at" timestamptz null;`);
    this.addSql(`alter table "role_assignments" add column "revoked_by_id" uuid null;`);
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_revoked_by_id_foreign"
        foreign key ("revoked_by_id") references "users" ("id") on update cascade on delete set null;
    `);
    // grantedBy is deliberately left null for every migrated row - the old
    // model never recorded who granted a Role, so this migration does not
    // invent an actor (e.g. by assuming the holder granted it to
    // themself). null is the correct, historical value here (see
    // RoleAssignment.grantedBy's own comment).

    // Old unique indexes keyed on membership_id; new ones key on user_id
    // and are partial on revoked_at IS NULL (a user may hold a fresh grant
    // of a Role they previously held and had revoked, without colliding
    // with the historical row - see role-assignment.entity.ts).
    this.addSql(
      `drop index "role_assignments_membership_id_group_id_role_unique";`,
    );
    this.addSql(`
      create unique index "role_assignments_user_id_group_id_role_unique"
        on "role_assignments" ("user_id", coalesce("group_id", "section_id"), "role")
        where ("revoked_at" is null);
    `);
    this.addSql(`drop index "role_assignments_group_id_owner_unique";`);
    this.addSql(`
      create unique index "role_assignments_group_id_owner_unique"
        on "role_assignments" (coalesce("group_id", "section_id"))
        where ("role" = 'OWNER' and "revoked_at" is null);
    `);

    // Drop the membership relation entirely - RoleAssignment no longer
    // has, or needs, any relation to a membership (see
    // role-assignment.entity.ts's own comment for why).
    this.addSql(
      `alter table "role_assignments" drop constraint "role_assignments_membership_id_foreign";`,
    );
    this.addSql(`drop index "role_assignments_membership_id_index";`);
    this.addSql(`alter table "role_assignments" drop column "membership_id";`);

    // Group only ever allows OWNER/ADMIN; Section allows all 5 - enforced
    // at the database level, not just in service-layer validation. Safe
    // to add now: hard stop 1 above already guarantees no existing row
    // violates it.
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_role_matches_target_check"
        check(("group_id" is not null and ("role" = 'OWNER' or "role" = 'ADMIN')) or ("section_id" is not null and ("role" = 'OWNER' or "role" = 'ADMIN' or "role" = 'INSTRUCTOR' or "role" = 'ASSISTANT' or "role" = 'MEMBER')));
    `);

    // ---- membership_suspensions / membership_cohorts: retarget FK ----
    // section_memberships rows preserve the exact same ids as the
    // group_memberships rows they were migrated from, so the FK *values*
    // in these two tables need no remapping - only the constraint's
    // target table changes.
    this.addSql(`
      alter table "membership_suspensions" drop constraint "membership_suspensions_membership_id_foreign";
    `);
    this.addSql(`
      alter table "membership_suspensions" add constraint "membership_suspensions_membership_id_foreign"
        foreign key ("membership_id") references "section_memberships" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "membership_cohorts" drop constraint "membership_cohorts_membership_id_foreign";
    `);
    this.addSql(`
      alter table "membership_cohorts" add constraint "membership_cohorts_membership_id_foreign"
        foreign key ("membership_id") references "section_memberships" ("id") on update cascade;
    `);

    // ---- group_bans -> section_bans ----
    // Hard stop 3 above guarantees this table is empty, so this is a pure
    // rename/retype with no data to move.
    this.addSql(`alter table "group_bans" rename to "section_bans";`);
    this.addSql(
      `alter table "section_bans" rename column "root_group_id" to "section_id";`,
    );
    this.addSql(
      `alter index "group_bans_pkey" rename to "section_bans_pkey";`,
    );
    this.addSql(
      `alter index "group_bans_root_group_id_index" rename to "section_bans_section_id_index";`,
    );
    this.addSql(
      `alter index "group_bans_user_id_index" rename to "section_bans_user_id_index";`,
    );
    this.addSql(`
      alter index "group_bans_root_group_id_user_id_active_unique" rename to "section_bans_section_id_user_id_active_unique";
    `);
    this.addSql(`
      alter table "section_bans" drop constraint "group_bans_root_group_id_foreign";
    `);
    this.addSql(`
      alter table "section_bans" add constraint "section_bans_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      alter table "section_bans" rename constraint "group_bans_banned_by_id_foreign" to "section_bans_banned_by_id_foreign";
    `);
    this.addSql(`
      alter table "section_bans" rename constraint "group_bans_lifted_by_id_foreign" to "section_bans_lifted_by_id_foreign";
    `);
    this.addSql(`
      alter table "section_bans" rename constraint "group_bans_user_id_foreign" to "section_bans_user_id_foreign";
    `);

    // ---- community_notification_settings: retarget Group -> Section ----
    // Hard stop 3 above guarantees this table is empty.
    this.addSql(`
      alter table "community_notification_settings" drop constraint "community_notification_settings_community_id_foreign";
    `);
    this.addSql(`
      alter table "community_notification_settings" add constraint "community_notification_settings_community_id_foreign"
        foreign key ("community_id") references "sections" ("id") on update cascade on delete cascade;
    `);

    // ---- audit_log_entries: single Group FK -> dual Group/Section FK ----
    // Every existing row already references a Group (audit logging had no
    // other option before) - renaming the column and dropping NOT NULL
    // preserves every row's value unchanged; section_id is simply never
    // populated for pre-existing rows.
    this.addSql(
      `alter table "audit_log_entries" rename column "community_id" to "group_id";`,
    );
    this.addSql(
      `alter table "audit_log_entries" alter column "group_id" drop not null;`,
    );
    this.addSql(`
      alter index "audit_log_entries_community_id_index" rename to "audit_log_entries_group_id_index";
    `);
    this.addSql(`
      alter table "audit_log_entries" rename constraint "audit_log_entries_community_id_foreign" to "audit_log_entries_group_id_foreign";
    `);
    this.addSql(
      `alter table "audit_log_entries" add column "section_id" uuid null;`,
    );
    this.addSql(
      `create index "audit_log_entries_section_id_index" on "audit_log_entries" ("section_id");`,
    );
    this.addSql(`
      alter table "audit_log_entries" add constraint "audit_log_entries_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      alter table "audit_log_entries" add constraint "audit_log_entries_group_or_section_check"
        check (("group_id" is not null and "section_id" is null) or ("group_id" is null and "section_id" is not null));
    `);

    // ---- finally: drop group_memberships now that every dependent FK has moved off it ----
    this.addSql(`drop table "group_memberships" cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`
      create table "group_memberships" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "root_group_id" uuid not null,
        "user_id" uuid not null,
        "status" text check ("status" in ('INVITED', 'ACTIVE', 'READ_ONLY', 'ARCHIVED')) not null default 'ACTIVE',
        "joined_at" timestamptz not null,
        "left_at" timestamptz null,
        "end_reason" text check ("end_reason" in ('LEFT', 'REMOVED', 'BANNED')) null,
        constraint "group_memberships_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "group_memberships_root_group_id_index" on "group_memberships" ("root_group_id");`,
    );
    this.addSql(
      `create index "group_memberships_user_id_index" on "group_memberships" ("user_id");`,
    );
    this.addSql(
      `create index "group_memberships_root_group_id_user_id_status_index" on "group_memberships" ("root_group_id", "user_id", "status");`,
    );
    this.addSql(`
      create unique index "group_memberships_root_group_id_user_id_active_unique"
        on "group_memberships" ("root_group_id", "user_id") where ("status" = 'ACTIVE');
    `);
    this.addSql(`
      alter table "group_memberships" add constraint "group_memberships_root_group_id_foreign"
        foreign key ("root_group_id") references "groups" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "group_memberships" add constraint "group_memberships_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      insert into "group_memberships"
        ("id", "created_at", "updated_at", "root_group_id", "user_id", "status", "joined_at", "left_at", "end_reason")
      select sm."id", sm."created_at", sm."updated_at", s."parent_group_id", sm."user_id", sm."status", sm."joined_at", sm."left_at", sm."end_reason"
      from "section_memberships" sm
      join "sections" s on s."id" = sm."section_id"
      where s."parent_group_id" is not null;
    `);

    this.addSql(`
      alter table "membership_suspensions" drop constraint "membership_suspensions_membership_id_foreign";
    `);
    this.addSql(`
      alter table "membership_suspensions" add constraint "membership_suspensions_membership_id_foreign"
        foreign key ("membership_id") references "group_memberships" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "membership_cohorts" drop constraint "membership_cohorts_membership_id_foreign";
    `);
    this.addSql(`
      alter table "membership_cohorts" add constraint "membership_cohorts_membership_id_foreign"
        foreign key ("membership_id") references "group_memberships" ("id") on update cascade;
    `);

    this.addSql(
      `alter table "role_assignments" drop constraint "role_assignments_role_matches_target_check";`,
    );
    this.addSql(`alter table "role_assignments" add column "membership_id" uuid null;`);
    // Section-target rows: section_memberships rows carry forward the
    // exact same id their originating group_memberships row had (see
    // up()), so this is an exact, lossless recovery - must run before
    // section_memberships is dropped below.
    this.addSql(`
      update "role_assignments" ra set "membership_id" = sm."id"
      from "section_memberships" sm
      where ra."section_id" is not null and sm."section_id" = ra."section_id" and sm."user_id" = ra."user_id";
    `);
    // Group-target rows never had a membership under the new model (Group
    // has none), so there is no original id to recover here - this
    // matches by (root_group_id, user_id) against the group_memberships
    // rows reconstructed above instead, which is best-effort (a fresh id,
    // not necessarily the pre-migration one) rather than exact, since none
    // of these rows carry the information needed for exact recovery.
    this.addSql(`
      update "role_assignments" ra set "membership_id" = gm."id"
      from "group_memberships" gm
      where ra."user_id" = gm."user_id" and ra."group_id" is not null and gm."root_group_id" = ra."group_id";
    `);

    this.addSql(`drop table "section_memberships" cascade;`);

    this.addSql(
      `create index "role_assignments_membership_id_index" on "role_assignments" ("membership_id");`,
    );
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_membership_id_foreign"
        foreign key ("membership_id") references "group_memberships" ("id") on update cascade;
    `);
    this.addSql(`drop index "role_assignments_group_id_owner_unique";`);
    this.addSql(`
      create unique index "role_assignments_group_id_owner_unique"
        on "role_assignments" (coalesce("group_id", "section_id")) where ("role" = 'OWNER');
    `);
    this.addSql(
      `drop index "role_assignments_user_id_group_id_role_unique";`,
    );
    this.addSql(`
      create unique index "role_assignments_membership_id_group_id_role_unique"
        on "role_assignments" ("membership_id", coalesce("group_id", "section_id"), "role");
    `);
    this.addSql(
      `alter table "role_assignments" drop constraint "role_assignments_revoked_by_id_foreign";`,
    );
    this.addSql(`alter table "role_assignments" drop column "revoked_by_id";`);
    this.addSql(`alter table "role_assignments" drop column "revoked_at";`);
    this.addSql(
      `alter table "role_assignments" drop constraint "role_assignments_granted_by_id_foreign";`,
    );
    this.addSql(`alter table "role_assignments" drop column "granted_by_id";`);
    this.addSql(
      `alter table "role_assignments" drop constraint "role_assignments_user_id_foreign";`,
    );
    this.addSql(`drop index "role_assignments_user_id_index";`);
    this.addSql(`alter table "role_assignments" drop column "user_id";`);

    this.addSql(`
      alter table "section_bans" rename constraint "section_bans_banned_by_id_foreign" to "group_bans_banned_by_id_foreign";
    `);
    this.addSql(`
      alter table "section_bans" rename constraint "section_bans_lifted_by_id_foreign" to "group_bans_lifted_by_id_foreign";
    `);
    this.addSql(`
      alter table "section_bans" rename constraint "section_bans_user_id_foreign" to "group_bans_user_id_foreign";
    `);
    this.addSql(
      `alter table "section_bans" drop constraint "section_bans_section_id_foreign";`,
    );
    this.addSql(
      `alter table "section_bans" rename column "section_id" to "root_group_id";`,
    );
    this.addSql(`
      alter table "section_bans" add constraint "group_bans_root_group_id_foreign"
        foreign key ("root_group_id") references "groups" ("id") on update cascade;
    `);
    this.addSql(`
      alter index "section_bans_section_id_user_id_active_unique" rename to "group_bans_root_group_id_user_id_active_unique";
    `);
    this.addSql(
      `alter index "section_bans_user_id_index" rename to "group_bans_user_id_index";`,
    );
    this.addSql(
      `alter index "section_bans_section_id_index" rename to "group_bans_root_group_id_index";`,
    );
    this.addSql(`alter index "section_bans_pkey" rename to "group_bans_pkey";`);
    this.addSql(`alter table "section_bans" rename to "group_bans";`);

    this.addSql(`
      alter table "community_notification_settings" drop constraint "community_notification_settings_community_id_foreign";
    `);
    this.addSql(`
      alter table "community_notification_settings" add constraint "community_notification_settings_community_id_foreign"
        foreign key ("community_id") references "groups" ("id") on update cascade on delete cascade;
    `);

    this.addSql(`
      alter table "audit_log_entries" drop constraint "audit_log_entries_group_or_section_check";
    `);
    this.addSql(`
      alter table "audit_log_entries" drop constraint "audit_log_entries_section_id_foreign";
    `);
    this.addSql(`drop index "audit_log_entries_section_id_index";`);
    this.addSql(`alter table "audit_log_entries" drop column "section_id";`);
    this.addSql(`
      alter index "audit_log_entries_group_id_index" rename to "audit_log_entries_community_id_index";
    `);
    this.addSql(`
      alter table "audit_log_entries" rename constraint "audit_log_entries_group_id_foreign" to "audit_log_entries_community_id_foreign";
    `);
    this.addSql(
      `alter table "audit_log_entries" alter column "group_id" set not null;`,
    );
    this.addSql(
      `alter table "audit_log_entries" rename column "group_id" to "community_id";`,
    );
  }
}
