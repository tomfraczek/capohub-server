import { Migration } from '@mikro-orm/migrations';

// "Event lifecycle: USER-organized Event + usuwanie konta + archiwizacja
// Eventu" module. Two independent additions, bundled in one migration since
// both touch `events`:
//
// 1. `ARCHIVED` joins the EventStatus enum (widens the inline CHECK on
//    events.status and event_status_history.from_status/to_status - no
//    backfill needed, every existing status value is already a member of
//    the widened set).
// 2. Event's organizer identity gains an explicit `organizer_type`
//    discriminator and, for USER organizers, a `organizer_user_display_name`
//    snapshot - see event.entity.ts's class comment for why organizerUser
//    alone can no longer serve as that discriminator once it is allowed to
//    go null (organizer_user_id's FK below moves from `on delete no action`
//    to `on delete set null`). Existing rows are backfilled explicitly
//    (steps 2a/2b) before either new column is made NOT NULL/CHECK-
//    constrained, and before the old events_organizer_check is replaced -
//    no existing Event data is lost or left in a state neither the old nor
//    the new constraint would accept.
export class Migration20260824074804_AddEventArchivedAndOrganizerSnapshot extends Migration {
  override async up(): Promise<void> {
    // ---- 1. ARCHIVED joins EventStatus ----
    this.addSql(`alter table "events" drop constraint if exists "events_status_check";`);
    this.addSql(`
      alter table "events" add constraint "events_status_check"
        check ("status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED', 'ARCHIVED'));
    `);
    this.addSql(`alter table "event_status_history" drop constraint if exists "event_status_history_from_status_check";`);
    this.addSql(`
      alter table "event_status_history" add constraint "event_status_history_from_status_check"
        check ("from_status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED', 'ARCHIVED'));
    `);
    this.addSql(`alter table "event_status_history" drop constraint if exists "event_status_history_to_status_check";`);
    this.addSql(`
      alter table "event_status_history" add constraint "event_status_history_to_status_check"
        check ("to_status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED', 'ARCHIVED'));
    `);

    // ---- 2a. New columns, nullable at first - backfilled below before
    // either is made NOT NULL/CHECK-constrained ----
    this.addSql(`alter table "events" add column "organizer_type" text null;`);
    this.addSql(`alter table "events" add column "organizer_user_display_name" varchar(100) null;`);

    // ---- 2b. Backfill from the pre-existing, already-guaranteed-
    // mutually-exclusive columns (the two-way/three-way checks this
    // replaces already enforced exactly one of these three is set on every
    // existing row) ----
    this.addSql(`update "events" set "organizer_type" = 'GROUP' where "community_group_id" is not null;`);
    this.addSql(`update "events" set "organizer_type" = 'SECTION' where "community_section_id" is not null;`);
    this.addSql(`update "events" set "organizer_type" = 'USER' where "organizer_user_id" is not null;`);
    this.addSql(`
      update "events" e set "organizer_user_display_name" = u."display_name"
      from "users" u
      where e."organizer_user_id" = u."id" and e."organizer_type" = 'USER';
    `);

    // ---- 2c. Now safe to constrain ----
    this.addSql(`alter table "events" alter column "organizer_type" set not null;`);
    this.addSql(`
      alter table "events" add constraint "events_organizer_type_check"
        check ("organizer_type" in ('USER', 'GROUP', 'SECTION'));
    `);
    this.addSql(`create index "events_organizer_type_index" on "events" ("organizer_type");`);

    // ---- 2d. organizer_user_id may now go null on its own (see
    // event.entity.ts's organizerUser field) ----
    this.addSql(`alter table "events" drop constraint "events_organizer_user_id_foreign";`);
    this.addSql(`
      alter table "events" add constraint "events_organizer_user_id_foreign"
        foreign key ("organizer_user_id") references "users" ("id") on update cascade on delete set null;
    `);

    // ---- 2e. Replace the old exactly-one-of-three-FKs check with the
    // discriminator-driven one - see event.entity.ts's events_organizer_
    // identity_check comment ----
    this.addSql(`alter table "events" drop constraint "events_organizer_check";`);
    this.addSql(`
      alter table "events" add constraint "events_organizer_identity_check"
        check (
          ("organizer_type" = 'GROUP' and "community_group_id" is not null and "community_section_id" is null and "organizer_user_display_name" is null)
          or ("organizer_type" = 'SECTION' and "community_section_id" is not null and "community_group_id" is null and "organizer_user_display_name" is null)
          or ("organizer_type" = 'USER' and "community_group_id" is null and "community_section_id" is null and "organizer_user_display_name" is not null)
        );
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop constraint "events_organizer_identity_check";`);
    this.addSql(`
      alter table "events" add constraint "events_organizer_check"
        check (("community_group_id" is not null and "community_section_id" is null and "organizer_user_id" is null) or ("community_group_id" is null and "community_section_id" is not null and "organizer_user_id" is null) or ("community_group_id" is null and "community_section_id" is null and "organizer_user_id" is not null));
    `);

    this.addSql(`alter table "events" drop constraint "events_organizer_user_id_foreign";`);
    this.addSql(`
      alter table "events" add constraint "events_organizer_user_id_foreign"
        foreign key ("organizer_user_id") references "users" ("id") on update cascade on delete no action;
    `);

    this.addSql(`drop index "events_organizer_type_index";`);
    this.addSql(`alter table "events" drop constraint "events_organizer_type_check";`);
    this.addSql(`alter table "events" drop column "organizer_type";`);
    this.addSql(`alter table "events" drop column "organizer_user_display_name";`);

    this.addSql(`alter table "event_status_history" drop constraint if exists "event_status_history_to_status_check";`);
    this.addSql(`
      alter table "event_status_history" add constraint "event_status_history_to_status_check"
        check ("to_status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED'));
    `);
    this.addSql(`alter table "event_status_history" drop constraint if exists "event_status_history_from_status_check";`);
    this.addSql(`
      alter table "event_status_history" add constraint "event_status_history_from_status_check"
        check ("from_status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED'));
    `);
    this.addSql(`alter table "events" drop constraint if exists "events_status_check";`);
    this.addSql(`
      alter table "events" add constraint "events_status_check"
        check ("status" in ('DRAFT', 'PUBLISHED', 'CANCELLED', 'FINISHED'));
    `);
  }
}
