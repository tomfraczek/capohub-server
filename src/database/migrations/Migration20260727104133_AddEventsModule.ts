import { Migration } from '@mikro-orm/migrations';

// Adds the full Events module: events, an append-only status-history log,
// Owner/Organizer/Moderator role assignments (a separate tier from
// Community roles - see event-role-assignment.entity.ts), invitations,
// attendees (RSVP/waitlist/check-in), and per-Event guardian assignments
// for children.
export class Migration20260727104133_AddEventsModule extends Migration {
  override async up(): Promise<void> {
    // ─── 1. events ───────────────────────────────────────────────────────
    this.addSql(`
      create table "events" (
        "id"                uuid        not null,
        "created_at"        timestamptz not null,
        "updated_at"        timestamptz not null,
        "community_id"      uuid        not null,
        "created_by_id"     uuid        null,
        "type"              text        not null default 'CUSTOM' check ("type" in ('BATIZADO', 'WORKSHOP', 'SEMINAR', 'RODA', 'SHOW', 'TRIP', 'MEETING', 'OPEN_TRAINING', 'CUSTOM')),
        "custom_type_label" varchar(100) null,
        "name"              varchar(200) not null,
        "description"       text        null,
        "cover_image_url"   varchar(2048) null,
        "starts_at"         timestamptz not null,
        "ends_at"           timestamptz not null,
        "location_name"     text        null,
        "location_address"  text        null,
        "latitude"          real        null,
        "longitude"         real        null,
        "visibility"        text        not null default 'COMMUNITY_MEMBERS' check ("visibility" in ('PUBLIC', 'COMMUNITY_MEMBERS', 'INVITE_ONLY')),
        "status"            text        not null default 'DRAFT' check ("status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED')),
        "capacity"          int         null,
        "waitlist_policy"   text        not null default 'NONE' check ("waitlist_policy" in ('NONE', 'AUTOMATIC', 'MANUAL')),
        "public_code"       varchar(15) null,
        constraint "events_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "events_community_id_index" on "events" ("community_id");`);
    this.addSql(`create index "events_created_by_id_index" on "events" ("created_by_id");`);
    this.addSql(`create index "events_starts_at_index" on "events" ("starts_at");`);
    this.addSql(`create index "events_ends_at_index" on "events" ("ends_at");`);
    this.addSql(`create index "events_visibility_index" on "events" ("visibility");`);
    this.addSql(`create index "events_status_index" on "events" ("status");`);
    this.addSql(`create index "events_community_id_status_index" on "events" ("community_id", "status");`);
    this.addSql(`alter table "events" add constraint "events_public_code_unique" unique ("public_code");`);
    this.addSql(`
      alter table "events"
        add constraint "events_community_id_foreign"
        foreign key ("community_id") references "groups" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "events"
        add constraint "events_created_by_id_foreign"
        foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 2. event_status_history ─────────────────────────────────────────
    // Append-only, hand-rolled id/created_at (no updated_at) - mirrors
    // audit_log_entries. No delete cascade from "events" (Events are never
    // physically deleted, see ADR-007 and event.entity.ts).
    this.addSql(`
      create table "event_status_history" (
        "id"          uuid        not null,
        "event_id"    uuid        not null,
        "from_status" text        null check ("from_status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED')),
        "to_status"   text        not null check ("to_status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED')),
        "actor_id"    uuid        null,
        "reason"      text        null,
        "created_at"  timestamptz not null,
        constraint "event_status_history_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "event_status_history_event_id_index" on "event_status_history" ("event_id");`);
    this.addSql(`create index "event_status_history_created_at_index" on "event_status_history" ("created_at");`);
    this.addSql(`
      alter table "event_status_history"
        add constraint "event_status_history_event_id_foreign"
        foreign key ("event_id") references "events" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_status_history"
        add constraint "event_status_history_actor_id_foreign"
        foreign key ("actor_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 3. event_role_assignments ───────────────────────────────────────
    // Owner/Organizer/Moderator - a separate tier from Community roles (see
    // event-role-assignment.entity.ts). Exactly one active OWNER per event,
    // enforced by the partial unique index below (mirrors
    // ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX).
    this.addSql(`
      create table "event_role_assignments" (
        "id"            uuid        not null,
        "created_at"    timestamptz not null,
        "updated_at"    timestamptz not null,
        "event_id"      uuid        not null,
        "user_id"       uuid        not null,
        "role"          text        not null check ("role" in ('OWNER', 'ORGANIZER', 'MODERATOR')),
        "granted_at"    timestamptz not null,
        "granted_by_id" uuid        null,
        constraint "event_role_assignments_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "event_role_assignments_event_id_index" on "event_role_assignments" ("event_id");`);
    this.addSql(`create index "event_role_assignments_user_id_index" on "event_role_assignments" ("user_id");`);
    this.addSql(`
      alter table "event_role_assignments"
        add constraint "event_role_assignments_event_id_user_id_role_unique"
        unique ("event_id", "user_id", "role");
    `);
    this.addSql(`
      create unique index "event_role_assignments_event_id_owner_unique"
        on "event_role_assignments" ("event_id")
        where ("role" = 'OWNER');
    `);
    this.addSql(`
      alter table "event_role_assignments"
        add constraint "event_role_assignments_event_id_foreign"
        foreign key ("event_id") references "events" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_role_assignments"
        add constraint "event_role_assignments_user_id_foreign"
        foreign key ("user_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_role_assignments"
        add constraint "event_role_assignments_granted_by_id_foreign"
        foreign key ("granted_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 4. event_invitations ─────────────────────────────────────────────
    // Dual invited-user/invited-email pattern, mirrors membership_requests.
    // Only one PENDING invitation may exist per (event, invitedUser) and
    // per (event, invitedEmail) at a time.
    this.addSql(`
      create table "event_invitations" (
        "id"            uuid        not null,
        "created_at"    timestamptz not null,
        "updated_at"    timestamptz not null,
        "event_id"      uuid        not null,
        "invited_by_id" uuid        not null,
        "invited_user_id" uuid      null,
        "invited_email" varchar(255) null,
        "status"        text        not null default 'PENDING' check ("status" in ('PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED')),
        "responded_at"  timestamptz null,
        constraint "event_invitations_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "event_invitations_event_id_index" on "event_invitations" ("event_id");`);
    this.addSql(`create index "event_invitations_invited_by_id_index" on "event_invitations" ("invited_by_id");`);
    this.addSql(`create index "event_invitations_invited_user_id_index" on "event_invitations" ("invited_user_id");`);
    this.addSql(`create index "event_invitations_invited_email_index" on "event_invitations" ("invited_email");`);
    this.addSql(`
      create unique index "event_invitations_pending_user_unique"
        on "event_invitations" ("event_id", "invited_user_id")
        where ("status" = 'PENDING' and "invited_user_id" is not null);
    `);
    this.addSql(`
      create unique index "event_invitations_pending_email_unique"
        on "event_invitations" ("event_id", "invited_email")
        where ("status" = 'PENDING' and "invited_email" is not null);
    `);
    this.addSql(`
      alter table "event_invitations"
        add constraint "event_invitations_event_id_foreign"
        foreign key ("event_id") references "events" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_invitations"
        add constraint "event_invitations_invited_by_id_foreign"
        foreign key ("invited_by_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_invitations"
        add constraint "event_invitations_invited_user_id_foreign"
        foreign key ("invited_user_id") references "users" ("id") on update cascade;
    `);

    // ─── 5. event_attendees ───────────────────────────────────────────────
    // The "Uczestnik" - one row per person's (or child's) participation.
    // subject_user_id is set for SELF/CHILD_ACCOUNT rows only; a partial
    // unique index prevents the same User being registered twice for the
    // same Event. CHILD_DEPENDENT rows (subject_user_id null,
    // dependent_display_name set) are never deduped - see
    // event-attendee.entity.ts.
    this.addSql(`
      create table "event_attendees" (
        "id"                     uuid        not null,
        "created_at"             timestamptz not null,
        "updated_at"             timestamptz not null,
        "event_id"               uuid        not null,
        "registered_by_id"       uuid        not null,
        "subject_type"           text        not null check ("subject_type" in ('SELF', 'CHILD_ACCOUNT', 'CHILD_DEPENDENT')),
        "subject_user_id"        uuid        null,
        "dependent_display_name" varchar(150) null,
        "rsvp_status"            text        not null default 'GOING' check ("rsvp_status" in ('GOING', 'MAYBE', 'NOT_GOING')),
        "registered_at"          timestamptz not null,
        "is_waitlisted"          boolean     not null default false,
        "waitlisted_at"          timestamptz null,
        "promoted_at"            timestamptz null,
        "checked_in"             boolean     not null default false,
        "checked_in_at"          timestamptz null,
        "checked_in_by_id"       uuid        null,
        "check_in_method"        text        null check ("check_in_method" in ('QR', 'MANUAL')),
        constraint "event_attendees_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "event_attendees_event_id_index" on "event_attendees" ("event_id");`);
    this.addSql(`create index "event_attendees_registered_by_id_index" on "event_attendees" ("registered_by_id");`);
    this.addSql(`create index "event_attendees_subject_user_id_index" on "event_attendees" ("subject_user_id");`);
    this.addSql(`
      create unique index "event_attendees_event_id_subject_user_id_unique"
        on "event_attendees" ("event_id", "subject_user_id")
        where ("subject_user_id" is not null);
    `);
    this.addSql(`
      alter table "event_attendees"
        add constraint "event_attendees_event_id_foreign"
        foreign key ("event_id") references "events" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_attendees"
        add constraint "event_attendees_registered_by_id_foreign"
        foreign key ("registered_by_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_attendees"
        add constraint "event_attendees_subject_user_id_foreign"
        foreign key ("subject_user_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_attendees"
        add constraint "event_attendees_checked_in_by_id_foreign"
        foreign key ("checked_in_by_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ─── 6. event_guardian_assignments ───────────────────────────────────
    // "Opiekun wydarzenia" - separate from any global parent/child
    // relationship (see event-guardian-assignment.entity.ts). Exactly one
    // active (revoked_at is null) guardian per child attendee at a time.
    this.addSql(`
      create table "event_guardian_assignments" (
        "id"             uuid        not null,
        "created_at"     timestamptz not null,
        "updated_at"     timestamptz not null,
        "event_id"       uuid        not null,
        "attendee_id"    uuid        not null,
        "guardian_id"    uuid        not null,
        "assigned_by_id" uuid        not null,
        "assigned_at"    timestamptz not null,
        "revoked_at"     timestamptz null,
        constraint "event_guardian_assignments_pkey" primary key ("id")
      );
    `);
    this.addSql(`create index "event_guardian_assignments_event_id_index" on "event_guardian_assignments" ("event_id");`);
    this.addSql(`create index "event_guardian_assignments_attendee_id_index" on "event_guardian_assignments" ("attendee_id");`);
    this.addSql(`create index "event_guardian_assignments_guardian_id_index" on "event_guardian_assignments" ("guardian_id");`);
    this.addSql(`create index "event_guardian_assignments_assigned_by_id_index" on "event_guardian_assignments" ("assigned_by_id");`);
    this.addSql(`
      create unique index "event_guardian_assignments_attendee_id_active_unique"
        on "event_guardian_assignments" ("attendee_id")
        where ("revoked_at" is null);
    `);
    this.addSql(`
      alter table "event_guardian_assignments"
        add constraint "event_guardian_assignments_event_id_foreign"
        foreign key ("event_id") references "events" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_guardian_assignments"
        add constraint "event_guardian_assignments_attendee_id_foreign"
        foreign key ("attendee_id") references "event_attendees" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_guardian_assignments"
        add constraint "event_guardian_assignments_guardian_id_foreign"
        foreign key ("guardian_id") references "users" ("id") on update cascade;
    `);
    this.addSql(`
      alter table "event_guardian_assignments"
        add constraint "event_guardian_assignments_assigned_by_id_foreign"
        foreign key ("assigned_by_id") references "users" ("id") on update cascade;
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "event_guardian_assignments" cascade;`);
    this.addSql(`drop table if exists "event_attendees" cascade;`);
    this.addSql(`drop table if exists "event_invitations" cascade;`);
    this.addSql(`drop table if exists "event_role_assignments" cascade;`);
    this.addSql(`drop table if exists "event_status_history" cascade;`);
    this.addSql(`drop table if exists "events" cascade;`);
  }
}
