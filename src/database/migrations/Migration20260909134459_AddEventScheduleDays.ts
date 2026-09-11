import { Migration } from '@mikro-orm/migrations';

// Adds EventScheduleDay - an optional per-day breakdown of an Event's own
// startsAt/endsAt (module: "w piątek wydarzenie trwa do 18, w sobotę
// zaczyna się o 9... jak to ugryźć?") - purely descriptive, always empty
// for the common single-day Event. Event.startsAt/endsAt remain the one
// frame RSVP/capacity/waitlist/notifications/calendar-range-filtering
// actually operate on; this table changes none of that.
export class Migration20260909134459_AddEventScheduleDays extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "event_schedule_days" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "event_id" uuid not null, "starts_at" timestamptz not null, "ends_at" timestamptz not null, constraint "event_schedule_days_pkey" primary key ("id"), constraint event_schedule_days_ends_at_after_starts_at_check check ("ends_at" >= "starts_at"));`);
    this.addSql(`create index "event_schedule_days_event_id_index" on "event_schedule_days" ("event_id");`);

    this.addSql(`alter table "event_schedule_days" add constraint "event_schedule_days_event_id_foreign" foreign key ("event_id") references "events" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "event_schedule_days" cascade;`);
  }

}
