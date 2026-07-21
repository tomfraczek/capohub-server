import { Migration } from '@mikro-orm/migrations';

export class Migration20260720201702_AddRoleAssignments extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "role_assignments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "membership_id" uuid not null, "group_id" uuid not null, "role" text check ("role" in ('OWNER', 'ADMIN', 'INSTRUCTOR', 'ASSISTANT', 'MEMBER')) not null, "granted_at" timestamptz not null, constraint "role_assignments_pkey" primary key ("id"));`);
    this.addSql(`create index "role_assignments_membership_id_index" on "role_assignments" ("membership_id");`);
    this.addSql(`create index "role_assignments_group_id_index" on "role_assignments" ("group_id");`);
    // A Membership may hold *multiple* Roles for the same Group at once
    // (e.g. MEMBER + INSTRUCTOR + ADMIN together) - this only prevents
    // holding the exact same Role twice for the same (membership, group).
    this.addSql(`alter table "role_assignments" add constraint "role_assignments_membership_id_group_id_role_unique" unique ("membership_id", "group_id", "role");`);
    // Every Group must have exactly one active OWNER (see ADR-028) -
    // enforced independently of which Membership holds it.
    this.addSql(`create unique index "role_assignments_group_id_owner_unique" on "role_assignments" ("group_id") where ("role" = 'OWNER');`);

    // No "on delete cascade" - a Membership or Group is archived, never
    // physically deleted (see RoleAssignment entity), so a Role Assignment
    // never needs to be cleaned up by a delete of either side.
    this.addSql(`alter table "role_assignments" add constraint "role_assignments_membership_id_foreign" foreign key ("membership_id") references "group_memberships" ("id") on update cascade;`);
    this.addSql(`alter table "role_assignments" add constraint "role_assignments_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade;`);

    // Backfill: under the old model, GroupMembership.role was the Role a
    // user held in its own Root Group (no Child Group roles existed yet -
    // see ADR-028). Every existing group_memberships row already
    // references an actual Root Group (enforced by the previous
    // migration), so this is a direct 1:1 mapping - one Role Assignment
    // per existing Membership, scoped to that Membership's own Root Group,
    // carrying the exact Role value it already had. Role Assignments
    // persist regardless of Membership status (validity is computed
    // dynamically at read time, not stored - see RoleAssignment entity),
    // so this intentionally does not filter by status: an ARCHIVED
    // membership's historical Role is preserved here exactly as it was
    // preserved in the old model.
    this.addSql(`
      insert into "role_assignments" ("id", "created_at", "updated_at", "membership_id", "group_id", "role", "granted_at")
      select gen_random_uuid(), now(), now(), "id", "root_group_id", "role", "joined_at"
      from "group_memberships";
    `);

    // Defensive check: the insert above is 1:1 on group_memberships.id, so
    // it cannot itself violate the new unique constraint - but this second
    // check exists purely to abort with a clear, specific error instead of
    // silently trusting the insert if it were ever changed to something
    // less than 1:1.
    this.addSql(`
      do $$
      declare
        missing_count integer;
      begin
        select count(*) into missing_count
        from group_memberships gm
        left join role_assignments ra
          on ra.membership_id = gm.id and ra.group_id = gm.root_group_id
        where ra.id is null;

        if missing_count > 0 then
          raise exception 'Migration20260720201702: % group_memberships row(s) have no corresponding role_assignments row after backfill - aborting', missing_count;
        end if;
      end $$;
    `);

    this.addSql(`alter table "group_memberships" drop constraint if exists "group_memberships_role_check";`);
    this.addSql(`alter table "group_memberships" drop column "role";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "group_memberships" add column "role" text check ("role" in ('OWNER', 'ADMIN', 'INSTRUCTOR', 'ASSISTANT', 'MEMBER')) null;`);

    // Reverse the backfill using each membership's own Root Group Role
    // Assignment(s) - the old model only had room for one Role per
    // Membership, so where a Membership now holds several Roles for its
    // Root Group (a state that cannot exist for data migrated by this same
    // migration's up(), but may exist after real multi-role usage), the
    // highest tier wins (OWNER > ADMIN > INSTRUCTOR > ASSISTANT > MEMBER).
    // Any Role Assignment for a Child Group has no equivalent in the old
    // model and is deliberately dropped here, mirroring this project's
    // existing convention of not handling every downgrade edge case (see
    // Migration20260720185928's down()).
    this.addSql(`
      update "group_memberships" gm
      set "role" = ranked."role"
      from (
        select distinct on (ra."membership_id") ra."membership_id", ra."role"
        from "role_assignments" ra
        order by ra."membership_id", case ra."role"
          when 'OWNER' then 1
          when 'ADMIN' then 2
          when 'INSTRUCTOR' then 3
          when 'ASSISTANT' then 4
          else 5
        end
      ) as ranked
      where ranked."membership_id" = gm."id";
    `);
    this.addSql(`update "group_memberships" set "role" = 'MEMBER' where "role" is null;`);
    this.addSql(`alter table "group_memberships" alter column "role" set not null;`);

    this.addSql(`drop table if exists "role_assignments" cascade;`);
  }

}
