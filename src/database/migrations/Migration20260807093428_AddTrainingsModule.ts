import { Migration } from '@mikro-orm/migrations';

export class Migration20260807093428_AddTrainingsModule extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "training_series" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "section_id" uuid not null, "day_of_week" smallint not null, "start_time" varchar(5) not null, "duration_minutes" int not null, "location_name" text null, "location_address" text null, "latitude" real null, "longitude" real null, "default_trainer_id" uuid not null, "default_description" text null, "visibility" text check ("visibility" in ('MEMBERS_ONLY', 'PUBLIC')) not null default 'MEMBERS_ONLY', "allow_external_rsvp" boolean not null default false, "start_date" date not null, "end_date" date not null, "created_by_id" uuid null, constraint "training_series_pkey" primary key ("id"), constraint training_series_date_range_check check ("end_date" >= "start_date"));`);
    this.addSql(`create index "training_series_section_id_index" on "training_series" ("section_id");`);
    this.addSql(`create index "training_series_default_trainer_id_index" on "training_series" ("default_trainer_id");`);

    this.addSql(`create table "trainings" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "section_id" uuid not null, "series_id" uuid null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, "location_name" text null, "location_address" text null, "latitude" real null, "longitude" real null, "trainer_id" uuid not null, "description" text null, "training_plan" text null, "trainer_notes" text null, "visibility" text check ("visibility" in ('MEMBERS_ONLY', 'PUBLIC')) not null default 'MEMBERS_ONLY', "allow_external_rsvp" boolean not null default false, "status" text check ("status" in ('SCHEDULED', 'CANCELLED')) not null default 'SCHEDULED', "created_by_id" uuid null, constraint "trainings_pkey" primary key ("id"), constraint trainings_starts_before_ends_check check ("starts_at" < "ends_at"));`);
    this.addSql(`create index "trainings_section_id_index" on "trainings" ("section_id");`);
    this.addSql(`create index "trainings_trainer_id_index" on "trainings" ("trainer_id");`);
    this.addSql(`create index "trainings_visibility_index" on "trainings" ("visibility");`);
    this.addSql(`create index "trainings_status_index" on "trainings" ("status");`);
    this.addSql(`create index "trainings_status_starts_at_index" on "trainings" ("status", "starts_at");`);
    this.addSql(`create index "trainings_trainer_id_starts_at_index" on "trainings" ("trainer_id", "starts_at");`);
    this.addSql(`create index "trainings_series_id_starts_at_index" on "trainings" ("series_id", "starts_at");`);
    this.addSql(`create index "trainings_section_id_starts_at_index" on "trainings" ("section_id", "starts_at");`);

    this.addSql(`create table "training_rsvps" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "training_id" uuid not null, "user_id" uuid not null, "status" text check ("status" in ('YES', 'NO', 'MAYBE')) not null, "responded_at" timestamptz not null, constraint "training_rsvps_pkey" primary key ("id"));`);
    this.addSql(`create index "training_rsvps_training_id_index" on "training_rsvps" ("training_id");`);
    this.addSql(`create index "training_rsvps_user_id_index" on "training_rsvps" ("user_id");`);
    this.addSql(`alter table "training_rsvps" add constraint "training_rsvps_training_id_user_id_unique" unique ("training_id", "user_id");`);

    this.addSql(`create table "training_notifications" ("id" uuid not null, "recipient_id" uuid not null, "training_id" uuid not null, "type" text check ("type" in ('TRAINING_REMINDER', 'TRAINING_CANCELLED', 'TRAINING_TIME_CHANGED', 'TRAINING_LOCATION_CHANGED', 'TRAINING_TRAINER_CHANGED')) not null, "created_at" timestamptz not null, constraint "training_notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "training_notifications_recipient_id_index" on "training_notifications" ("recipient_id");`);
    this.addSql(`create index "training_notifications_training_id_index" on "training_notifications" ("training_id");`);

    this.addSql(`create table "training_attendances" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "training_id" uuid not null, "user_id" uuid not null, "attended" boolean not null default true, "recorded_by_id" uuid null, "recorded_at" timestamptz not null, constraint "training_attendances_pkey" primary key ("id"));`);
    this.addSql(`create index "training_attendances_training_id_index" on "training_attendances" ("training_id");`);
    this.addSql(`create index "training_attendances_user_id_index" on "training_attendances" ("user_id");`);
    this.addSql(`alter table "training_attendances" add constraint "training_attendances_training_id_user_id_unique" unique ("training_id", "user_id");`);

    this.addSql(`alter table "training_series" add constraint "training_series_section_id_foreign" foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "training_series" add constraint "training_series_default_trainer_id_foreign" foreign key ("default_trainer_id") references "users" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "training_series" add constraint "training_series_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "trainings" add constraint "trainings_section_id_foreign" foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "trainings" add constraint "trainings_series_id_foreign" foreign key ("series_id") references "training_series" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "trainings" add constraint "trainings_trainer_id_foreign" foreign key ("trainer_id") references "users" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "trainings" add constraint "trainings_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "training_rsvps" add constraint "training_rsvps_training_id_foreign" foreign key ("training_id") references "trainings" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "training_rsvps" add constraint "training_rsvps_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "training_notifications" add constraint "training_notifications_recipient_id_foreign" foreign key ("recipient_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "training_notifications" add constraint "training_notifications_training_id_foreign" foreign key ("training_id") references "trainings" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "training_attendances" add constraint "training_attendances_training_id_foreign" foreign key ("training_id") references "trainings" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "training_attendances" add constraint "training_attendances_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "training_attendances" add constraint "training_attendances_recorded_by_id_foreign" foreign key ("recorded_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_action_check";`);
    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_target_type_check";`);

    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_action_check" check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD', 'CREATE_GRADUATION_SYSTEM', 'UPDATE_GRADUATION_SYSTEM', 'CREATE_RANK', 'UPDATE_RANK', 'REORDER_RANK', 'ARCHIVE_RANK', 'RESTORE_RANK', 'REQUEST_FORMAL_RANK_CORRECTION', 'SUBMIT_FORMAL_RANK_CORRECTION', 'APPROVE_FORMAL_RANK_CORRECTION', 'REJECT_FORMAL_RANK_CORRECTION', 'CREATE_TRAINING', 'UPDATE_TRAINING', 'CANCEL_TRAINING', 'CREATE_TRAINING_SERIES', 'UPDATE_TRAINING_SERIES', 'CANCEL_TRAINING_SERIES', 'RECORD_TRAINING_ATTENDANCE'));`);
    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_target_type_check" check("target_type" in ('COMMUNITY', 'USER', 'ROLE_ASSIGNMENT', 'MEMBERSHIP_REQUEST', 'HIERARCHY_INVITATION', 'GRADUATION_SYSTEM', 'RANK', 'TRAINING', 'TRAINING_SERIES'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "trainings" drop constraint "trainings_series_id_foreign";`);

    this.addSql(`alter table "training_rsvps" drop constraint "training_rsvps_training_id_foreign";`);

    this.addSql(`alter table "training_notifications" drop constraint "training_notifications_training_id_foreign";`);

    this.addSql(`alter table "training_attendances" drop constraint "training_attendances_training_id_foreign";`);

    this.addSql(`drop table if exists "training_series" cascade;`);

    this.addSql(`drop table if exists "trainings" cascade;`);

    this.addSql(`drop table if exists "training_rsvps" cascade;`);

    this.addSql(`drop table if exists "training_notifications" cascade;`);

    this.addSql(`drop table if exists "training_attendances" cascade;`);

    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_action_check";`);
    this.addSql(`alter table "audit_log_entries" drop constraint if exists "audit_log_entries_target_type_check";`);

    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_action_check" check("action" in ('CREATE_COMMUNITY', 'UPDATE_COMMUNITY', 'ARCHIVE', 'RESTORE', 'DELETE', 'CREATE_CHILD_GROUP', 'TRANSFER_OWNERSHIP', 'INVITE_MEMBER', 'ACCEPT_INVITATION', 'DECLINE_INVITATION', 'JOIN_REQUEST', 'APPROVE_JOIN_REQUEST', 'REJECT_JOIN_REQUEST', 'ADD_ROLE', 'REMOVE_ROLE', 'REMOVE_MEMBER', 'LEAVE_COMMUNITY', 'BAN', 'UNBAN', 'SUSPEND', 'UNSUSPEND', 'INVITE_CHILD', 'ACCEPT_CHILD_INVITATION', 'REJECT_CHILD_INVITATION', 'CANCEL_CHILD_INVITATION', 'ATTACH_CHILD', 'DETACH_CHILD', 'MOVE_CHILD', 'CREATE_GRADUATION_SYSTEM', 'UPDATE_GRADUATION_SYSTEM', 'CREATE_RANK', 'UPDATE_RANK', 'REORDER_RANK', 'ARCHIVE_RANK', 'RESTORE_RANK', 'REQUEST_FORMAL_RANK_CORRECTION', 'SUBMIT_FORMAL_RANK_CORRECTION', 'APPROVE_FORMAL_RANK_CORRECTION', 'REJECT_FORMAL_RANK_CORRECTION'));`);
    this.addSql(`alter table "audit_log_entries" add constraint "audit_log_entries_target_type_check" check("target_type" in ('COMMUNITY', 'USER', 'ROLE_ASSIGNMENT', 'MEMBERSHIP_REQUEST', 'HIERARCHY_INVITATION', 'GRADUATION_SYSTEM', 'RANK'));`);
  }

}
