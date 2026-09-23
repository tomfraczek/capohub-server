import { Migration } from '@mikro-orm/migrations';

// Career History audit §3 finding: career_timeline_entries.event_id was a
// live FK with no snapshot at all - the original "Events are never hard-
// deleted, so no snapshot is needed" reasoning addressed only deletion,
// not editing. An organizer renaming/rescheduling/relocating an Event years
// later would retroactively rewrite what a user's career-timeline entry
// displayed, even though the entry's own `occurred_on` (the date *they*
// received the rank/attended) is a separate, already-correct field.
//
// Adds a snapshot of exactly what the timeline card displays about the
// linked Event - name, start date, location - deliberately not the whole
// Event (type/endsAt/organizer stay live-joined via event_id, since
// they're secondary and this audit's scope is name/date/place, "ewentualnie
// organizator" being explicitly optional per the audit brief).
//
// Backfill strategy for existing rows: this is NOT a guess - it copies the
// *current* Event data into the snapshot, i.e. exactly what every existing
// entry already displays today (since there was no snapshot before, the
// mapper always read live data). This freezes today's already-correct
// display going forward; it does not and cannot recover what the Event
// looked like at the moment each entry was originally linked, which is
// unknowable and is not fabricated here.
export class Migration20260923090000_AddCareerTimelineEventSnapshot extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "career_timeline_entries" add column "event_name_snapshot" varchar(200) null;`);
    this.addSql(`alter table "career_timeline_entries" add column "event_starts_at_snapshot" timestamptz null;`);
    this.addSql(`alter table "career_timeline_entries" add column "event_location_name_snapshot" varchar(200) null;`);

    this.addSql(`
      update "career_timeline_entries" cte
      set "event_name_snapshot" = e."name",
          "event_starts_at_snapshot" = e."starts_at",
          "event_location_name_snapshot" = e."location_name"
      from "events" e
      where cte."event_id" = e."id";
    `);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "career_timeline_entries" drop column "event_name_snapshot";`);
    this.addSql(`alter table "career_timeline_entries" drop column "event_starts_at_snapshot";`);
    this.addSql(`alter table "career_timeline_entries" drop column "event_location_name_snapshot";`);
  }

}
