import { Migration } from '@mikro-orm/migrations';

// Adds the formal rank correction workflow (see
// formal-rank-correction-request.entity.ts): fixing a misrecorded
// FormalRankAssignment.rank, never a new award - this migration never
// touches the existing formal_rank_assignments table itself, only adds
// two new, empty tables alongside it:
//  - formal_rank_correction_requests, with a partial unique index
//    guaranteeing at most one *active* (CORRECTION_REQUIRED/
//    PENDING_APPROVAL/REJECTED) request per FormalRankAssignment.
//  - formal_rank_correction_notifications, a minimal in-app-only
//    notification record (no push/email infrastructure exists in this
//    codebase - see that entity's own comment).
// Also widens audit_log_entries_action_check for the workflow's 4 new
// AuditAction values - no new AuditTargetType is needed (every one of
// these actions targets AuditTargetType.USER, same precedent as
// ADD_ROLE/REMOVE_ROLE/BAN). Purely additive, no data reinterpretation,
// so - like the graduation module's own prior migrations - this has no
// dedicated .itest.ts.
export class Migration20260806121301_AddFormalRankCorrectionWorkflow extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "formal_rank_correction_requests" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "formal_rank_assignment_id" uuid not null, "target_user_id" uuid not null, "section_id" uuid not null, "reported_by_id" uuid null, "status" text check ("status" in ('CORRECTION_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED')) not null default 'CORRECTION_REQUIRED', "submitted_rank_id" uuid null, "submitted_awarded_by_name" varchar(150) null, "reason" text null, "submitted_at" timestamptz null, "reviewed_at" timestamptz null, "reviewed_by_id" uuid null, "rejection_reason" text null, constraint "formal_rank_correction_requests_pkey" primary key ("id"));`);
    this.addSql(`create index "formal_rank_correction_requests_formal_rank_assignment_id_index" on "formal_rank_correction_requests" ("formal_rank_assignment_id");`);
    this.addSql(`create index "formal_rank_correction_requests_target_user_id_index" on "formal_rank_correction_requests" ("target_user_id");`);
    this.addSql(`create index "formal_rank_correction_requests_section_id_index" on "formal_rank_correction_requests" ("section_id");`);
    this.addSql(`create index "formal_rank_correction_requests_reported_by_id_index" on "formal_rank_correction_requests" ("reported_by_id");`);
    this.addSql(`create index "formal_rank_correction_requests_status_index" on "formal_rank_correction_requests" ("status");`);
    this.addSql(`create index "formal_rank_correction_requests_submitted_rank_id_index" on "formal_rank_correction_requests" ("submitted_rank_id");`);
    this.addSql(`create unique index "formal_rank_correction_requests_assignment_active_unique" on public.formal_rank_correction_requests ("formal_rank_assignment_id") where ("status" in ('CORRECTION_REQUIRED', 'PENDING_APPROVAL', 'REJECTED'));`);

    this.addSql(`create table "formal_rank_correction_notifications" ("id" uuid not null, "recipient_id" uuid not null, "type" text check ("type" in ('FORMAL_RANK_CORRECTION_REQUESTED', 'FORMAL_RANK_CORRECTION_SUBMITTED', 'FORMAL_RANK_CORRECTION_APPROVED', 'FORMAL_RANK_CORRECTION_REJECTED')) not null, "correction_request_id" uuid not null, "created_at" timestamptz not null, constraint "formal_rank_correction_notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "formal_rank_correction_notifications_recipient_id_index" on "formal_rank_correction_notifications" ("recipient_id");`);
    this.addSql(`create index "formal_rank_correction_notifications_type_index" on "formal_rank_correction_notifications" ("type");`);
    this.addSql(`create index "formal_rank_correction_notifications_correction_re_7881c_index" on "formal_rank_correction_notifications" ("correction_request_id");`);
    this.addSql(`create index "formal_rank_correction_notifications_created_at_index" on "formal_rank_correction_notifications" ("created_at");`);

    this.addSql(`alter table "formal_rank_correction_requests" add constraint "formal_rank_correction_requests_formal_rank_assi_0ac9d_foreign" foreign key ("formal_rank_assignment_id") references "formal_rank_assignments" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "formal_rank_correction_requests" add constraint "formal_rank_correction_requests_target_user_id_foreign" foreign key ("target_user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "formal_rank_correction_requests" add constraint "formal_rank_correction_requests_section_id_foreign" foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "formal_rank_correction_requests" add constraint "formal_rank_correction_requests_reported_by_id_foreign" foreign key ("reported_by_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "formal_rank_correction_requests" add constraint "formal_rank_correction_requests_submitted_rank_id_foreign" foreign key ("submitted_rank_id") references "ranks" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "formal_rank_correction_requests" add constraint "formal_rank_correction_requests_reviewed_by_id_foreign" foreign key ("reviewed_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "formal_rank_correction_notifications" add constraint "formal_rank_correction_notifications_recipient_id_foreign" foreign key ("recipient_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "formal_rank_correction_notifications" add constraint "formal_rank_correction_notifications_correction__86eef_foreign" foreign key ("correction_request_id") references "formal_rank_correction_requests" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_action_check";`);

    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_action_check" check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD', 'CREATE_GRADUATION_SYSTEM', 'UPDATE_GRADUATION_SYSTEM', 'CREATE_RANK', 'UPDATE_RANK', 'REORDER_RANK', 'ARCHIVE_RANK', 'RESTORE_RANK', 'REQUEST_FORMAL_RANK_CORRECTION', 'SUBMIT_FORMAL_RANK_CORRECTION', 'APPROVE_FORMAL_RANK_CORRECTION', 'REJECT_FORMAL_RANK_CORRECTION'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "formal_rank_correction_notifications" drop constraint "formal_rank_correction_notifications_correction__86eef_foreign";`);

    this.addSql(`drop table if exists "formal_rank_correction_requests" cascade;`);

    this.addSql(`drop table if exists "formal_rank_correction_notifications" cascade;`);

    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_action_check";`);

    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_action_check" check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD', 'CREATE_GRADUATION_SYSTEM', 'UPDATE_GRADUATION_SYSTEM', 'CREATE_RANK', 'UPDATE_RANK', 'REORDER_RANK', 'ARCHIVE_RANK', 'RESTORE_RANK'));`);
  }

}
