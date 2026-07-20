import { Migration } from '@mikro-orm/migrations';

export class Migration20260720185928_MembershipRootGroupAndSections extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "membership_sections" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "membership_id" uuid not null, "section_id" uuid not null, constraint "membership_sections_pkey" primary key ("id"));`);
    this.addSql(`create index "membership_sections_membership_id_index" on "membership_sections" ("membership_id");`);
    this.addSql(`create index "membership_sections_section_id_index" on "membership_sections" ("section_id");`);
    this.addSql(`alter table "membership_sections" add constraint "membership_sections_membership_id_section_id_unique" unique ("membership_id", "section_id");`);

    this.addSql(`alter table "membership_sections" add constraint "membership_sections_membership_id_foreign" foreign key ("membership_id") references "group_memberships" ("id") on update cascade;`);
    this.addSql(`alter table "membership_sections" add constraint "membership_sections_section_id_foreign" foreign key ("section_id") references "sections" ("id") on update cascade;`);

    // Membership now represents participation in an organization as a
    // whole (see organization-entities.md#membership) - every existing row
    // must reference an actual Root Group. Abort rather than silently
    // migrate data we cannot map unambiguously: a row pointing at a Child
    // Group could theoretically be remapped to that Child Group's Root
    // Group, but that would silently rewrite which specific Group a
    // historical membership/role row was recorded against, which is a
    // meaning-changing rewrite, not a safe one - so this migration refuses
    // to guess and requires a manual data fix instead.
    this.addSql(`
      do $$
      declare
        violating_count integer;
      begin
        select count(*) into violating_count
        from group_memberships gm
        join groups g on g.id = gm.group_id
        where g.parent_group_id is not null;

        if violating_count > 0 then
          raise exception 'Migration20260720185928: % group_memberships row(s) reference a Child Group instead of a Root Group - cannot safely remap automatically, fix the data manually before re-running this migration', violating_count;
        end if;
      end $$;
    `);

    this.addSql(`alter table "group_memberships" drop constraint if exists "group_memberships_status_check";`);

    this.addSql(`alter table "group_memberships" add column "end_reason" text check ("end_reason" in ('LEFT', 'REMOVED')) null;`);

    // Backfill: the documented Membership status set (INVITED / ACTIVE /
    // READ_ONLY / ARCHIVED - see organization-entities.md#membership) has
    // no separate "left" vs "removed" status; both collapse into ARCHIVED,
    // with the distinction preserved in the new end_reason column instead
    // (see GroupMembership entity) so no historical information is lost.
    this.addSql(`update "group_memberships" set "end_reason" = "status" where "status" in ('LEFT', 'REMOVED');`);
    this.addSql(`update "group_memberships" set "status" = 'ARCHIVED' where "status" in ('LEFT', 'REMOVED');`);

    this.addSql(`alter table "group_memberships" add constraint "group_memberships_status_check" check("status" in ('INVITED', 'ACTIVE', 'READ_ONLY', 'ARCHIVED'));`);

    this.addSql(`alter table "group_memberships" drop constraint "group_memberships_group_id_foreign";`);

    this.addSql(`drop index "group_memberships_group_id_index";`);
    this.addSql(`drop index "group_memberships_group_id_user_id_active_unique";`);
    this.addSql(`drop index "group_memberships_group_id_user_id_status_index";`);

    this.addSql(`alter table "group_memberships" rename column "group_id" to "root_group_id";`);
    this.addSql(`alter table "group_memberships" add constraint "group_memberships_root_group_id_foreign" foreign key ("root_group_id") references "groups" ("id") on update cascade on delete cascade;`);
    this.addSql(`create index "group_memberships_root_group_id_index" on "group_memberships" ("root_group_id");`);
    this.addSql(`create index "group_memberships_root_group_id_user_id_status_index" on "group_memberships" ("root_group_id", "user_id", "status");`);
    this.addSql(`create unique index "group_memberships_root_group_id_user_id_active_unique" on public.group_memberships ("root_group_id", "user_id") where ("status" = 'ACTIVE');`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "membership_sections" cascade;`);

    this.addSql(`alter table "group_memberships" drop constraint if exists "group_memberships_status_check";`);

    this.addSql(`alter table "group_memberships" drop constraint "group_memberships_root_group_id_foreign";`);

    this.addSql(`drop index "group_memberships_root_group_id_index";`);
    this.addSql(`drop index "group_memberships_root_group_id_user_id_status_index";`);
    this.addSql(`alter table "group_memberships" drop constraint "group_memberships_root_group_id_user_id_active_unique";`);

    // Reverse the ARCHIVED+end_reason collapse back into LEFT/REMOVED
    // where possible - INVITED/READ_ONLY rows have no equivalent in the
    // old enum and would violate the constraint below; this mirrors the
    // project's existing convention of not handling every downgrade edge
    // case (see Migration20260719164219_AddGroupStatusReadOnly's down()).
    this.addSql(`update "group_memberships" set "status" = "end_reason" where "end_reason" is not null;`);
    this.addSql(`alter table "group_memberships" drop column "end_reason";`);

    this.addSql(`alter table "group_memberships" add constraint "group_memberships_status_check" check("status" in ('ACTIVE', 'LEFT', 'REMOVED'));`);
    this.addSql(`alter table "group_memberships" rename column "root_group_id" to "group_id";`);
    this.addSql(`alter table "group_memberships" add constraint "group_memberships_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade on delete cascade;`);
    this.addSql(`create index "group_memberships_group_id_index" on "group_memberships" ("group_id");`);
    this.addSql(`CREATE UNIQUE INDEX group_memberships_group_id_user_id_active_unique ON public.group_memberships USING btree (group_id, user_id) WHERE (status = 'ACTIVE'::text);`);
    this.addSql(`create index "group_memberships_group_id_user_id_status_index" on "group_memberships" ("group_id", "user_id", "status");`);
  }

}
