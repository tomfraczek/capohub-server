import { Migration } from '@mikro-orm/migrations';

// Adds the graduation (rank) catalog module: graduation_systems, ranks,
// rank_cord_segments, custom_user_ranks, custom_user_rank_cord_segments
// and user_rank_assignments (see src/graduation/entities). Purely
// additive - every new table starts empty, no existing row anywhere is
// touched, and no existing user/Group is assigned a rank by this
// migration (see the module spec: "Nowe tabele powinny być puste"). The
// two audit_log_entries CHECK constraints are widened to include the 7
// new AuditAction values and 2 new AuditTargetType values this module
// adds. No data reinterpretation, so - like
// Migration20260805100000_AddUserProfileAndFormalGroupAffiliation - this
// migration has no dedicated .itest.ts.
export class Migration20260806092143_AddGraduationCatalog extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "graduation_systems" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "group_id" uuid not null, "name" varchar(150) not null, "is_active" boolean not null default true, constraint "graduation_systems_pkey" primary key ("id"));`);
    this.addSql(`create index "graduation_systems_group_id_index" on "graduation_systems" ("group_id");`);
    this.addSql(`create unique index "graduation_systems_group_id_active_unique" on public.graduation_systems ("group_id") where ("is_active" is true);`);

    this.addSql(`create table "ranks" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "system_id" uuid not null, "track" text check ("track" in ('CHILD', 'ADULT')) not null, "name" varchar(150) not null, "description" text null, "previous_rank_id" uuid null, "is_archived" boolean not null default false, constraint "ranks_pkey" primary key ("id"), constraint ranks_previous_rank_not_self_check check ("previous_rank_id" is null or "previous_rank_id" <> "id"));`);
    this.addSql(`create index "ranks_system_id_index" on "ranks" ("system_id");`);
    this.addSql(`create index "ranks_track_index" on "ranks" ("track");`);
    this.addSql(`create index "ranks_previous_rank_id_index" on "ranks" ("previous_rank_id");`);
    this.addSql(`create unique index "ranks_system_id_track_first_rank_unique" on public.ranks ("system_id", "track") where ("previous_rank_id" is null);`);
    this.addSql(`create unique index "ranks_previous_rank_id_unique" on public.ranks ("previous_rank_id") where ("previous_rank_id" is not null);`);

    this.addSql(`create table "rank_cord_segments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "rank_id" uuid not null, "position" smallint not null, "color_hex" varchar(7) not null, "proportion" real not null, constraint "rank_cord_segments_pkey" primary key ("id"), constraint rank_cord_segments_proportion_positive_check check ("proportion" > 0), constraint rank_cord_segments_color_hex_check check ("color_hex" ~ '^#[0-9A-Fa-f]{6}\$'));`);
    this.addSql(`create index "rank_cord_segments_rank_id_index" on "rank_cord_segments" ("rank_id");`);
    this.addSql(`alter table "rank_cord_segments" add constraint "rank_cord_segments_rank_id_position_unique" unique ("rank_id", "position");`);

    this.addSql(`create table "custom_user_ranks" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "name" varchar(150) not null, "description" text null, "track" text check ("track" in ('CHILD', 'ADULT')) not null, constraint "custom_user_ranks_pkey" primary key ("id"));`);
    this.addSql(`create index "custom_user_ranks_user_id_index" on "custom_user_ranks" ("user_id");`);

    this.addSql(`create table "custom_user_rank_cord_segments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "custom_rank_id" uuid not null, "position" smallint not null, "color_hex" varchar(7) not null, "proportion" real not null, constraint "custom_user_rank_cord_segments_pkey" primary key ("id"), constraint custom_user_rank_cord_segments_proportion_positive_check check ("proportion" > 0), constraint custom_user_rank_cord_segments_color_hex_check check ("color_hex" ~ '^#[0-9A-Fa-f]{6}\$'));`);
    this.addSql(`create index "custom_user_rank_cord_segments_custom_rank_id_index" on "custom_user_rank_cord_segments" ("custom_rank_id");`);
    this.addSql(`alter table "custom_user_rank_cord_segments" add constraint "custom_user_rank_cord_segments_custom_rank_id_position_unique" unique ("custom_rank_id", "position");`);

    this.addSql(`create table "user_rank_assignments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "catalog_rank_id" uuid null, "custom_rank_id" uuid null, "source_group_id" uuid null, "started_on" date null, "ended_on" date null, "awarded_by_name" varchar(150) null, constraint "user_rank_assignments_pkey" primary key ("id"), constraint user_rank_assignments_ended_on_after_started_on_check check ("started_on" is null or "ended_on" is null or "ended_on" >= "started_on"), constraint user_rank_assignments_catalog_xor_custom_check check (("catalog_rank_id" is not null and "custom_rank_id" is null and "source_group_id" is not null) or ("catalog_rank_id" is null and "custom_rank_id" is not null and "source_group_id" is null)));`);
    this.addSql(`create index "user_rank_assignments_user_id_index" on "user_rank_assignments" ("user_id");`);
    this.addSql(`create index "user_rank_assignments_catalog_rank_id_index" on "user_rank_assignments" ("catalog_rank_id");`);
    this.addSql(`create index "user_rank_assignments_custom_rank_id_index" on "user_rank_assignments" ("custom_rank_id");`);
    this.addSql(`create index "user_rank_assignments_source_group_id_index" on "user_rank_assignments" ("source_group_id");`);
    this.addSql(`create unique index "user_rank_assignments_user_id_active_unique" on public.user_rank_assignments ("user_id") where ("ended_on" is null);`);

    this.addSql(`alter table "graduation_systems" add constraint "graduation_systems_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "ranks" add constraint "ranks_system_id_foreign" foreign key ("system_id") references "graduation_systems" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "ranks" add constraint "ranks_previous_rank_id_foreign" foreign key ("previous_rank_id") references "ranks" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "rank_cord_segments" add constraint "rank_cord_segments_rank_id_foreign" foreign key ("rank_id") references "ranks" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "custom_user_ranks" add constraint "custom_user_ranks_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "custom_user_rank_cord_segments" add constraint "custom_user_rank_cord_segments_custom_rank_id_foreign" foreign key ("custom_rank_id") references "custom_user_ranks" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_catalog_rank_id_foreign" foreign key ("catalog_rank_id") references "ranks" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_custom_rank_id_foreign" foreign key ("custom_rank_id") references "custom_user_ranks" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_source_group_id_foreign" foreign key ("source_group_id") references "groups" ("id") on update cascade on delete no action;`);

    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_action_check";`);
    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_target_type_check";`);

    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_action_check" check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD', 'CREATE_GRADUATION_SYSTEM', 'UPDATE_GRADUATION_SYSTEM', 'CREATE_RANK', 'UPDATE_RANK', 'REORDER_RANK', 'ARCHIVE_RANK', 'RESTORE_RANK'));`);
    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_target_type_check" check("target_type" in ('COMMUNITY', 'USER', 'ROLE_ASSIGNMENT', 'MEMBERSHIP_REQUEST', 'HIERARCHY_INVITATION', 'GRADUATION_SYSTEM', 'RANK'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "ranks" drop constraint "ranks_system_id_foreign";`);

    this.addSql(`alter table "ranks" drop constraint "ranks_previous_rank_id_foreign";`);

    this.addSql(`alter table "rank_cord_segments" drop constraint "rank_cord_segments_rank_id_foreign";`);

    this.addSql(`alter table "user_rank_assignments" drop constraint "user_rank_assignments_catalog_rank_id_foreign";`);

    this.addSql(`alter table "custom_user_rank_cord_segments" drop constraint "custom_user_rank_cord_segments_custom_rank_id_foreign";`);

    this.addSql(`alter table "user_rank_assignments" drop constraint "user_rank_assignments_custom_rank_id_foreign";`);

    this.addSql(`drop table if exists "graduation_systems" cascade;`);

    this.addSql(`drop table if exists "ranks" cascade;`);

    this.addSql(`drop table if exists "rank_cord_segments" cascade;`);

    this.addSql(`drop table if exists "custom_user_ranks" cascade;`);

    this.addSql(`drop table if exists "custom_user_rank_cord_segments" cascade;`);

    this.addSql(`drop table if exists "user_rank_assignments" cascade;`);

    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_action_check";`);
    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_target_type_check";`);

    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_action_check" check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD'));`);
    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_target_type_check" check("target_type" in ('COMMUNITY', 'USER', 'ROLE_ASSIGNMENT', 'MEMBERSHIP_REQUEST', 'HIERARCHY_INVITATION'));`);
  }

}
