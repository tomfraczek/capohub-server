import { Migration } from '@mikro-orm/migrations';

// Adds the backend support needed for the Community administrative module:
// permanent (but still non-physical, see ADR-029) Community deletion,
// member Ban/Unban, member Suspend/Unsuspend, the Community Audit Log, and
// per-user Community Notification settings.
export class Migration20260724100000_AddCommunityAdministration extends Migration {
  override async up(): Promise<void> {
    // ─── 1. GroupStatus.DELETED ────────────────────────────────────────────
    this.addSql(
      `alter table "groups" drop constraint if exists "groups_status_check";`,
    );
    this.addSql(
      `alter table "groups" add constraint "groups_status_check" check("status" in ('ACTIVE', 'READ_ONLY', 'ARCHIVED', 'DELETED'));`,
    );

    // ─── 2. MembershipEndReason.BANNED ─────────────────────────────────────
    this.addSql(
      `alter table "group_memberships" drop constraint if exists "group_memberships_end_reason_check";`,
    );
    this.addSql(
      `alter table "group_memberships" add constraint "group_memberships_end_reason_check" check("end_reason" in ('LEFT', 'REMOVED', 'BANNED'));`,
    );

    // ─── 3. group_bans ──────────────────────────────────────────────────────
    // `user_id`/`banned_by_id` are nullable (unlike a typical required FK)
    // specifically so `on delete set null` is possible below - a User
    // account can be physically deleted (DELETE /users/me) independently of
    // any ban record referencing them, either as the banned party or as the
    // admin who banned/unbanned someone else (see GroupBan's entity comment).
    this.addSql(`
      create table "group_bans" (
        "id"             uuid        not null,
        "created_at"     timestamptz not null,
        "updated_at"     timestamptz not null,
        "root_group_id"  uuid        not null,
        "user_id"        uuid        null,
        "banned_by_id"   uuid        null,
        "banned_at"      timestamptz not null,
        "reason"         text        null,
        "lifted_at"      timestamptz null,
        "lifted_by_id"   uuid        null,
        constraint "group_bans_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "group_bans_root_group_id_index" on "group_bans" ("root_group_id");`,
    );
    this.addSql(
      `create index "group_bans_user_id_index" on "group_bans" ("user_id");`,
    );
    this.addSql(`
      create unique index "group_bans_root_group_id_user_id_active_unique"
        on "group_bans" ("root_group_id", "user_id")
        where ("lifted_at" is null);
    `);
    this.addSql(`
      alter table "group_bans"
        add constraint "group_bans_root_group_id_foreign"
        foreign key ("root_group_id") references "groups" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "group_bans"
        add constraint "group_bans_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "group_bans"
        add constraint "group_bans_banned_by_id_foreign"
        foreign key ("banned_by_id") references "users" ("id") on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "group_bans"
        add constraint "group_bans_lifted_by_id_foreign"
        foreign key ("lifted_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 4. membership_suspensions ──────────────────────────────────────────
    // `suspended_by_id` is nullable for the same `on delete set null` reason
    // as group_bans above. `membership_id` cascades on delete - unlike
    // GroupBan, a suspension record is meaningless once its own Membership
    // is gone (see MembershipSuspension's entity comment); the SUSPEND/
    // UNSUSPEND facts themselves are preserved independently, forever, in
    // audit_log_entries.
    this.addSql(`
      create table "membership_suspensions" (
        "id"             uuid        not null,
        "created_at"     timestamptz not null,
        "updated_at"     timestamptz not null,
        "membership_id"  uuid        not null,
        "suspended_by_id" uuid       null,
        "suspended_at"   timestamptz not null,
        "until"          timestamptz null,
        "reason"         text        null,
        "lifted_at"      timestamptz null,
        "lifted_by_id"   uuid        null,
        constraint "membership_suspensions_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "membership_suspensions_membership_id_index" on "membership_suspensions" ("membership_id");`,
    );
    this.addSql(`
      create unique index "membership_suspensions_membership_id_active_unique"
        on "membership_suspensions" ("membership_id")
        where ("lifted_at" is null);
    `);
    this.addSql(`
      alter table "membership_suspensions"
        add constraint "membership_suspensions_membership_id_foreign"
        foreign key ("membership_id") references "group_memberships" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "membership_suspensions"
        add constraint "membership_suspensions_suspended_by_id_foreign"
        foreign key ("suspended_by_id") references "users" ("id") on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "membership_suspensions"
        add constraint "membership_suspensions_lifted_by_id_foreign"
        foreign key ("lifted_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 5. audit_log_entries ───────────────────────────────────────────────
    this.addSql(`
      create table "audit_log_entries" (
        "id"           uuid        not null,
        "community_id" uuid        not null,
        "action"       text        not null check ("action" in (
          'CREATE_COMMUNITY','UPDATE_COMMUNITY','ARCHIVE','RESTORE','DELETE',
          'CREATE_CHILD_GROUP','TRANSFER_OWNERSHIP','INVITE_MEMBER',
          'ACCEPT_INVITATION','DECLINE_INVITATION','JOIN_REQUEST',
          'APPROVE_JOIN_REQUEST','REJECT_JOIN_REQUEST','ADD_ROLE','REMOVE_ROLE',
          'REMOVE_MEMBER','LEAVE_COMMUNITY','BAN','UNBAN','SUSPEND','UNSUSPEND'
        )),
        "actor_id"     uuid        null,
        "target_type"  text        null check ("target_type" in ('COMMUNITY','USER','ROLE_ASSIGNMENT','MEMBERSHIP_REQUEST')),
        "target_id"    uuid        null,
        "description"  text        null,
        "metadata"     jsonb       null,
        "created_at"   timestamptz not null,
        constraint "audit_log_entries_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "audit_log_entries_community_id_index" on "audit_log_entries" ("community_id");`,
    );
    this.addSql(
      `create index "audit_log_entries_action_index" on "audit_log_entries" ("action");`,
    );
    this.addSql(
      `create index "audit_log_entries_actor_id_index" on "audit_log_entries" ("actor_id");`,
    );
    this.addSql(
      `create index "audit_log_entries_created_at_index" on "audit_log_entries" ("created_at");`,
    );
    this.addSql(`
      alter table "audit_log_entries"
        add constraint "audit_log_entries_community_id_foreign"
        foreign key ("community_id") references "groups" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "audit_log_entries"
        add constraint "audit_log_entries_actor_id_foreign"
        foreign key ("actor_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 6. community_notification_settings ─────────────────────────────────
    this.addSql(`
      create table "community_notification_settings" (
        "id"                    uuid        not null,
        "created_at"            timestamptz not null,
        "updated_at"            timestamptz not null,
        "community_id"          uuid        not null,
        "user_id"               uuid        not null,
        "new_join_requests"     boolean     not null default true,
        "join_request_approved" boolean     not null default true,
        "new_invitations"       boolean     not null default true,
        "invitation_accepted"   boolean     not null default true,
        "invitation_rejected"   boolean     not null default true,
        "role_changes"          boolean     not null default true,
        "transfer_ownership"    boolean     not null default true,
        "archived"              boolean     not null default true,
        "restored"              boolean     not null default true,
        "community_deleted"     boolean     not null default true,
        constraint "community_notification_settings_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "community_notification_settings_community_id_index" on "community_notification_settings" ("community_id");`,
    );
    this.addSql(
      `create index "community_notification_settings_user_id_index" on "community_notification_settings" ("user_id");`,
    );
    this.addSql(`
      alter table "community_notification_settings"
        add constraint "community_notification_settings_community_id_user_id_unique"
        unique ("community_id", "user_id");
    `);
    this.addSql(`
      alter table "community_notification_settings"
        add constraint "community_notification_settings_community_id_foreign"
        foreign key ("community_id") references "groups" ("id") on update cascade on delete cascade;
    `);
    this.addSql(`
      alter table "community_notification_settings"
        add constraint "community_notification_settings_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "community_notification_settings" cascade;`);
    this.addSql(`drop table if exists "audit_log_entries" cascade;`);
    this.addSql(`drop table if exists "membership_suspensions" cascade;`);
    this.addSql(`drop table if exists "group_bans" cascade;`);

    this.addSql(
      `alter table "group_memberships" drop constraint if exists "group_memberships_end_reason_check";`,
    );
    this.addSql(
      `alter table "group_memberships" add constraint "group_memberships_end_reason_check" check("end_reason" in ('LEFT', 'REMOVED'));`,
    );

    this.addSql(
      `alter table "groups" drop constraint if exists "groups_status_check";`,
    );
    this.addSql(
      `alter table "groups" add constraint "groups_status_check" check("status" in ('ACTIVE', 'READ_ONLY', 'ARCHIVED'));`,
    );
  }
}
