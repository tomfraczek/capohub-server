import { Migration } from '@mikro-orm/migrations';

// Adds the hierarchy_invitations table (see
// hierarchy-invitation.entity.ts) - the mechanism for proposing that a
// Group or Section be attached under a parent Group when the inviting
// actor manages the parent but not the target (see
// HierarchyManagementService). A brand-new, empty table - no existing data
// to migrate or reinterpret, unlike the two prior stages of the
// organizational-domain rebuild.
//
// `parent_group_id` already correctly modeled the hierarchy for direct
// attach/detach/move (see GroupHierarchyService.attachChildGroup/
// attachSection, already present since the Group/Section physical split) -
// this migration adds nothing there, only the invitation model itself.
export class Migration20260804150000_AddHierarchyInvitations extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "hierarchy_invitations" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "parent_group_id" uuid not null,
        "target_group_id" uuid null,
        "target_section_id" uuid null,
        "invited_by_id" uuid null,
        "status" text check ("status" in ('PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED')) not null default 'PENDING',
        "responded_at" timestamptz null,
        "responded_by_id" uuid null,
        constraint "hierarchy_invitations_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "hierarchy_invitations_parent_group_id_index" on "hierarchy_invitations" ("parent_group_id");`,
    );
    this.addSql(
      `create index "hierarchy_invitations_target_group_id_index" on "hierarchy_invitations" ("target_group_id");`,
    );
    this.addSql(
      `create index "hierarchy_invitations_target_section_id_index" on "hierarchy_invitations" ("target_section_id");`,
    );
    this.addSql(
      `create index "hierarchy_invitations_invited_by_id_index" on "hierarchy_invitations" ("invited_by_id");`,
    );

    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_parent_group_id_foreign"
        foreign key ("parent_group_id") references "groups" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_target_group_id_foreign"
        foreign key ("target_group_id") references "groups" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_target_section_id_foreign"
        foreign key ("target_section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_invited_by_id_foreign"
        foreign key ("invited_by_id") references "users" ("id") on update cascade on delete set null;
    `);
    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_responded_by_id_foreign"
        foreign key ("responded_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // Exactly one of target_group_id/target_section_id, never both, never
    // neither - same XOR pattern as role_assignments/membership_requests.
    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_target_group_or_section_check"
        check (("target_group_id" is not null and "target_section_id" is null) or ("target_group_id" is null and "target_section_id" is not null));
    `);
    // A Group can never invite itself as its own child. NULL comparisons
    // satisfy a CHECK, so this is a no-op for Section-target rows.
    this.addSql(`
      alter table "hierarchy_invitations" add constraint "hierarchy_invitations_no_self_parent_check"
        check ("parent_group_id" <> "target_group_id");
    `);
    // At most one PENDING invitation per (parentGroup, target) relation -
    // coalesce folds the two nullable target FKs into one comparison key.
    this.addSql(`
      create unique index "hierarchy_invitations_pending_relation_unique"
        on "hierarchy_invitations" ("parent_group_id", coalesce("target_group_id", "target_section_id"))
        where ("status" = 'PENDING');
    `);

    // audit_log_entries.action/target_type are backed by a CHECK constraint
    // enumerating every AuditAction/AuditTargetType value (see
    // audit-log-entry.entity.ts) - both enums gained 7 and 1 new values
    // respectively for this stage (INVITE_CHILD/ACCEPT_CHILD_INVITATION/
    // REJECT_CHILD_INVITATION/CANCEL_CHILD_INVITATION/ATTACH_CHILD/
    // DETACH_CHILD/MOVE_CHILD, and HIERARCHY_INVITATION), so both
    // constraints are widened accordingly. No data rewrite - every existing
    // row's value is still a member of the new, larger allow-list.
    this.addSql(
      `alter table "audit_log_entries" drop constraint "audit_log_entries_action_check";`,
    );
    this.addSql(`
      alter table "audit_log_entries" add constraint "audit_log_entries_action_check"
        check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD'));
    `);
    this.addSql(
      `alter table "audit_log_entries" drop constraint "audit_log_entries_target_type_check";`,
    );
    this.addSql(`
      alter table "audit_log_entries" add constraint "audit_log_entries_target_type_check"
        check("target_type" in ('COMMUNITY', 'USER', 'ROLE_ASSIGNMENT', 'MEMBERSHIP_REQUEST', 'HIERARCHY_INVITATION'));
    `);
  }

  override async down(): Promise<void> {
    this.addSql(
      `alter table "audit_log_entries" drop constraint "audit_log_entries_target_type_check";`,
    );
    this.addSql(`
      alter table "audit_log_entries" add constraint "audit_log_entries_target_type_check"
        check("target_type" in ('COMMUNITY', 'USER', 'ROLE_ASSIGNMENT', 'MEMBERSHIP_REQUEST'));
    `);
    this.addSql(
      `alter table "audit_log_entries" drop constraint "audit_log_entries_action_check";`,
    );
    this.addSql(`
      alter table "audit_log_entries" add constraint "audit_log_entries_action_check"
        check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND'));
    `);

    this.addSql(`drop table "hierarchy_invitations" cascade;`);
  }
}
