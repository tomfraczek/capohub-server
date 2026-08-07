import { Migration } from '@mikro-orm/migrations';

// Collapses EventType down to the final 4-value catalog (FESTIVAL,
// WORKSHOP, OPEN_RODA, OTHER - see event-type.enum.ts) and makes `type`
// immutable after creation at the application layer (see
// update-event.schema.ts / EventsService.update).
//
// None of BATIZADO/SEMINAR/RODA/SHOW/TRIP/MEETING/OPEN_TRAINING/CUSTOM has
// a safe, unambiguous 1:1 mapping to the new catalog - in particular
// BATIZADO and (a future) TROCA_DE_CORDA are program elements of a
// FESTIVAL, not their own EventType, but "usually held during a festival"
// is not the same as "is a FESTIVAL", so this migration never guesses that
// mapping. Any pre-existing "events" row whose type is not already one of
// the 4 final values hard-stops the migration (see the guard below) and
// must be resolved manually (re-typed to the correct new value, or removed
// with explicit approval) before re-running.
export class Migration20260807075703_AlignEventTypeToFourValues extends Migration {
  override async up(): Promise<void> {
    // ---- Hard stop: any "events" row outside the final 4-value catalog ----
    this.addSql(`
      do $$
      declare
        blocked text;
      begin
        select string_agg(
          format('event_id=%s title=%s old_type=%s', e.id, e.name, e.type),
          e'\\n'
        )
        into blocked
        from "events" e
        where e."type" not in ('FESTIVAL', 'WORKSHOP', 'OPEN_RODA', 'OTHER');

        if blocked is not null then
          raise exception e'Migration20260807075703_AlignEventTypeToFourValues: cannot proceed - the following events row(s) have a type outside the final catalog (FESTIVAL, WORKSHOP, OPEN_RODA, OTHER). This migration will not guess a mapping (e.g. BATIZADO/TROCA_DE_CORDA -> FESTIVAL is not automatic - "usually during a festival" is not "is a festival"). Resolve manually per row (re-type it to the correct new value via a direct UPDATE, or remove the row with explicit approval) and re-run.\\n%', blocked;
        end if;
      end $$;
    `);

    this.addSql(`alter table "events" drop constraint if exists "events_type_check";`);
    this.addSql(`alter table "events" alter column "type" type text using ("type"::text);`);
    this.addSql(`alter table "events" alter column "type" set default 'OTHER';`);
    this.addSql(`alter table "events" add constraint "events_type_check" check("type" in ('FESTIVAL', 'WORKSHOP', 'OPEN_RODA', 'OTHER'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop constraint if exists "events_type_check";`);
    this.addSql(`alter table "events" alter column "type" type text using ("type"::text);`);
    this.addSql(`alter table "events" alter column "type" set default 'CUSTOM';`);
    this.addSql(`alter table "events" add constraint "events_type_check" check("type" in ('BATIZADO', 'WORKSHOP', 'SEMINAR', 'RODA', 'SHOW', 'TRIP', 'MEETING', 'OPEN_TRAINING', 'CUSTOM'));`);
  }
}
