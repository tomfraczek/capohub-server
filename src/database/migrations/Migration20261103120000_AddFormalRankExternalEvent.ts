import { Migration } from '@mikro-orm/migrations';

// A formal rank (and the request that proposes one) can name the event it
// was received at in free text, with a partial date, when that event isn't
// in CapoHub - see FormalRankAssignment.externalEventName.
export class Migration20261103120000_AddFormalRankExternalEvent extends Migration {

  override async up(): Promise<void> {
    for (const table of ['formal_rank_assignments', 'formal_rank_requests']) {
      this.addSql(`alter table "${table}" add column "external_event_name" varchar(150) null, add column "external_event_year" smallint null, add column "external_event_month" smallint null, add column "external_event_day" smallint null;`);
    }
  }

  override async down(): Promise<void> {
    for (const table of ['formal_rank_assignments', 'formal_rank_requests']) {
      this.addSql(`alter table "${table}" drop column "external_event_name", drop column "external_event_year", drop column "external_event_month", drop column "external_event_day";`);
    }
  }

}
