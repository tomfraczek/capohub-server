import { Migration } from '@mikro-orm/migrations';

// Adds the central Notifications module (see src/notifications/): one
// `notifications` table backing the in-app inbox for every domain
// integration (Trainings, Events, Announcements, Membership, Formal Rank
// Correction), `user_notification_preferences` (global push toggles) and
// `push_devices` (Expo push tokens). Also widens two pre-existing entities
// this module reuses rather than duplicates: `community_notification_settings`
// gets a `muted` column (per-Section push mute) and `announcements` gets an
// `is_important` column (drives IMPORTANT_ANNOUNCEMENT_PUBLISHED).
//
// Drops `training_notifications` and `formal_rank_correction_notifications`
// outright, with no backfill: both were confirmed empty in the dev database
// before this migration was written (0 rows each), and neither ever had a
// read/query endpoint exposing their contents to a client, so there is no
// data or API surface to migrate - see this module's final report.
export class Migration20260810092520_AddNotificationsModule extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "push_devices" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "expo_push_token" varchar(400) not null, "platform" text check ("platform" in ('IOS', 'ANDROID')) not null, "installation_id" varchar(200) null, "is_active" boolean not null default true, "last_seen_at" timestamptz not null, constraint "push_devices_pkey" primary key ("id"));`);
    this.addSql(`create index "push_devices_user_id_index" on "push_devices" ("user_id");`);
    this.addSql(`alter table "push_devices" add constraint "push_devices_expo_push_token_unique" unique ("expo_push_token");`);
    this.addSql(`create index "push_devices_is_active_index" on "push_devices" ("is_active");`);

    this.addSql(`create table "notifications" ("id" uuid not null, "recipient_id" uuid not null, "category" text check ("category" in ('COMMUNITY', 'TRAINING', 'EVENT', 'MEMBERSHIP', 'GRADUATION', 'PAYMENT', 'SYSTEM')) not null, "type" text check ("type" in ('TRAINING_CANCELLED', 'TRAINING_TIME_CHANGED', 'TRAINING_LOCATION_CHANGED', 'TRAINING_TRAINER_CHANGED', 'TRAINING_REMINDER_24H', 'TRAINING_REMINDER_2H', 'EVENT_INVITATION', 'EVENT_CANCELLED', 'EVENT_TIME_CHANGED', 'EVENT_LOCATION_CHANGED', 'EVENT_REMINDER_24H', 'EVENT_REMINDER_2H', 'ANNOUNCEMENT_PUBLISHED', 'IMPORTANT_ANNOUNCEMENT_PUBLISHED', 'SECTION_JOIN_REQUEST_RECEIVED', 'SECTION_JOIN_REQUEST_APPROVED', 'SECTION_JOIN_REQUEST_REJECTED', 'SECTION_INVITATION_RECEIVED', 'SECTION_INVITATION_ACCEPTED', 'SECTION_INVITATION_REJECTED', 'HIERARCHY_INVITATION_RECEIVED', 'HIERARCHY_INVITATION_ACCEPTED', 'HIERARCHY_INVITATION_REJECTED', 'FORMAL_RANK_CORRECTION_REQUIRED', 'FORMAL_RANK_CORRECTION_SUBMITTED', 'FORMAL_RANK_CORRECTION_APPROVED', 'FORMAL_RANK_CORRECTION_REJECTED')) not null, "title" varchar(200) not null, "body" text not null, "target_type" varchar(255) null, "target_id" uuid null, "context_group_id" uuid null, "context_section_id" uuid null, "actor_id" uuid null, "deduplication_key" varchar(200) null, "read_at" timestamptz null, "created_at" timestamptz not null, constraint "notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "notifications_recipient_id_index" on "notifications" ("recipient_id");`);
    this.addSql(`create index "notifications_type_index" on "notifications" ("type");`);
    this.addSql(`create index "notifications_context_group_id_index" on "notifications" ("context_group_id");`);
    this.addSql(`create index "notifications_context_section_id_index" on "notifications" ("context_section_id");`);
    this.addSql(`alter table "notifications" add constraint "notifications_deduplication_key_unique" unique ("deduplication_key");`);
    this.addSql(`create index "notifications_recipient_id_read_at_index" on "notifications" ("recipient_id", "read_at");`);
    this.addSql(`create index "notifications_recipient_id_created_at_index" on "notifications" ("recipient_id", "created_at");`);

    this.addSql(`create table "user_notification_preferences" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "push_enabled" boolean not null default true, "push_community" boolean not null default true, "push_training" boolean not null default true, "push_event" boolean not null default true, "push_membership" boolean not null default true, "push_graduation" boolean not null default true, "push_payment" boolean not null default true, "training_reminder24h" boolean not null default true, "training_reminder2h" boolean not null default true, "event_reminder24h" boolean not null default true, "event_reminder2h" boolean not null default true, constraint "user_notification_preferences_pkey" primary key ("id"));`);
    this.addSql(`alter table "user_notification_preferences" add constraint "user_notification_preferences_user_id_unique" unique ("user_id");`);

    this.addSql(`alter table "push_devices" add constraint "push_devices_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "notifications" add constraint "notifications_recipient_id_foreign" foreign key ("recipient_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "notifications" add constraint "notifications_context_group_id_foreign" foreign key ("context_group_id") references "groups" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "notifications" add constraint "notifications_context_section_id_foreign" foreign key ("context_section_id") references "sections" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "notifications" add constraint "notifications_actor_id_foreign" foreign key ("actor_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "user_notification_preferences" add constraint "user_notification_preferences_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`drop table if exists "formal_rank_correction_notifications" cascade;`);

    this.addSql(`drop table if exists "training_notifications" cascade;`);

    this.addSql(`alter table "community_notification_settings" add column "muted" boolean not null default false;`);

    this.addSql(`alter table "announcements" add column "is_important" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "formal_rank_correction_notifications" ("id" uuid not null, "recipient_id" uuid not null, "type" text check ("type" in ('FORMAL_RANK_CORRECTION_REQUESTED', 'FORMAL_RANK_CORRECTION_SUBMITTED', 'FORMAL_RANK_CORRECTION_APPROVED', 'FORMAL_RANK_CORRECTION_REJECTED')) not null, "correction_request_id" uuid not null, "created_at" timestamptz(6) not null, constraint "formal_rank_correction_notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "formal_rank_correction_notifications_correction_re_7881c_index" on "formal_rank_correction_notifications" ("correction_request_id");`);
    this.addSql(`create index "formal_rank_correction_notifications_created_at_index" on "formal_rank_correction_notifications" ("created_at");`);
    this.addSql(`create index "formal_rank_correction_notifications_recipient_id_index" on "formal_rank_correction_notifications" ("recipient_id");`);
    this.addSql(`create index "formal_rank_correction_notifications_type_index" on "formal_rank_correction_notifications" ("type");`);

    this.addSql(`create table "training_notifications" ("id" uuid not null, "recipient_id" uuid not null, "training_id" uuid not null, "type" text check ("type" in ('TRAINING_REMINDER', 'TRAINING_CANCELLED', 'TRAINING_TIME_CHANGED', 'TRAINING_LOCATION_CHANGED', 'TRAINING_TRAINER_CHANGED')) not null, "created_at" timestamptz(6) not null, constraint "training_notifications_pkey" primary key ("id"));`);
    this.addSql(`create index "training_notifications_recipient_id_index" on "training_notifications" ("recipient_id");`);
    this.addSql(`create index "training_notifications_training_id_index" on "training_notifications" ("training_id");`);

    this.addSql(`alter table "formal_rank_correction_notifications" add constraint "formal_rank_correction_notifications_correction__86eef_foreign" foreign key ("correction_request_id") references "formal_rank_correction_requests" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "formal_rank_correction_notifications" add constraint "formal_rank_correction_notifications_recipient_id_foreign" foreign key ("recipient_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "training_notifications" add constraint "training_notifications_recipient_id_foreign" foreign key ("recipient_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "training_notifications" add constraint "training_notifications_training_id_foreign" foreign key ("training_id") references "trainings" ("id") on update cascade on delete cascade;`);

    this.addSql(`drop table if exists "push_devices" cascade;`);

    this.addSql(`drop table if exists "notifications" cascade;`);

    this.addSql(`drop table if exists "user_notification_preferences" cascade;`);

    this.addSql(`alter table "announcements" drop column "is_important";`);

    this.addSql(`alter table "community_notification_settings" drop column "muted";`);
  }

}
