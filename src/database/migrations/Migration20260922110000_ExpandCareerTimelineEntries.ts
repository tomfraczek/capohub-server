import { Migration } from '@mikro-orm/migrations';

// Career History redesign: career_timeline_entries grows from a flat
// date/title/description note into a typed, optionally-linked milestone -
// see career-timeline-entry.entity.ts's own comment for the full field
// list and career-timeline-aggregation.service.ts for the SYSTEM side
// (unchanged schema-wise - STARTED_TEACHING/STARTED_SECTION/FOUNDED_GROUP
// are all derived from the existing role_assignments table at read time,
// nothing new to persist for them).
//
// Every pre-existing row only ever had a free-text title/description with
// no type concept at all - backfilled to OTHER (occurred_on_precision to
// DAY, since every existing row's date was always a full YYYY-MM-DD), the
// correct interpretation of "a wpis the user typed with no structure".
// `type`'s default is then dropped - every future row sets it explicitly
// (CareerTimelineEntriesService.applyInput always assigns it) - but
// occurred_on_precision keeps its DB default, matching the entity's own
// `default: CareerTimelinePrecision.DAY` decorator option.
export class Migration20260922110000_ExpandCareerTimelineEntries extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "career_timeline_entries" add column "type" text check ("type" in ('START_TRAINING', 'BATIZADO', 'RECEIVED_APELIDO', 'RECEIVED_RANK', 'JOINED_GROUP', 'LEFT_GROUP', 'STARTED_TEACHING', 'STARTED_SECTION', 'FOUNDED_GROUP', 'IMPORTANT_EVENT', 'ACHIEVEMENT', 'OTHER')) not null default 'OTHER';`);
    this.addSql(`alter table "career_timeline_entries" alter column "type" drop default;`);
    this.addSql(`create index "career_timeline_entries_type_index" on "career_timeline_entries" ("type");`);

    this.addSql(`alter table "career_timeline_entries" add column "occurred_on_precision" text check ("occurred_on_precision" in ('YEAR', 'MONTH', 'DAY')) not null default 'DAY';`);

    this.addSql(`alter table "career_timeline_entries" add column "group_id" uuid null, add column "group_name_snapshot" varchar(200) null;`);
    this.addSql(`alter table "career_timeline_entries" add constraint "career_timeline_entries_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "career_timeline_entries_group_id_index" on "career_timeline_entries" ("group_id");`);

    this.addSql(`alter table "career_timeline_entries" add column "section_id" uuid null, add column "section_name_snapshot" varchar(200) null;`);
    this.addSql(`alter table "career_timeline_entries" add constraint "career_timeline_entries_section_id_foreign" foreign key ("section_id") references "sections" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "career_timeline_entries_section_id_index" on "career_timeline_entries" ("section_id");`);

    this.addSql(`alter table "career_timeline_entries" add column "event_id" uuid null;`);
    this.addSql(`alter table "career_timeline_entries" add constraint "career_timeline_entries_event_id_foreign" foreign key ("event_id") references "events" ("id") on update cascade on delete set null;`);
    this.addSql(`create index "career_timeline_entries_event_id_index" on "career_timeline_entries" ("event_id");`);

    this.addSql(`alter table "career_timeline_entries" add column "apelido" varchar(100) null;`);
    this.addSql(`alter table "career_timeline_entries" add column "rank_name" varchar(100) null;`);
    this.addSql(`alter table "career_timeline_entries" add column "awarded_by_name" varchar(200) null;`);
    this.addSql(`alter table "career_timeline_entries" add column "location" varchar(200) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "career_timeline_entries" drop constraint "career_timeline_entries_group_id_foreign";`);
    this.addSql(`alter table "career_timeline_entries" drop constraint "career_timeline_entries_section_id_foreign";`);
    this.addSql(`alter table "career_timeline_entries" drop constraint "career_timeline_entries_event_id_foreign";`);

    this.addSql(`drop index "career_timeline_entries_type_index";`);
    this.addSql(`drop index "career_timeline_entries_group_id_index";`);
    this.addSql(`drop index "career_timeline_entries_section_id_index";`);
    this.addSql(`drop index "career_timeline_entries_event_id_index";`);

    this.addSql(`alter table "career_timeline_entries" drop column "type";`);
    this.addSql(`alter table "career_timeline_entries" drop column "occurred_on_precision";`);
    this.addSql(`alter table "career_timeline_entries" drop column "group_id";`);
    this.addSql(`alter table "career_timeline_entries" drop column "group_name_snapshot";`);
    this.addSql(`alter table "career_timeline_entries" drop column "section_id";`);
    this.addSql(`alter table "career_timeline_entries" drop column "section_name_snapshot";`);
    this.addSql(`alter table "career_timeline_entries" drop column "event_id";`);
    this.addSql(`alter table "career_timeline_entries" drop column "apelido";`);
    this.addSql(`alter table "career_timeline_entries" drop column "rank_name";`);
    this.addSql(`alter table "career_timeline_entries" drop column "awarded_by_name";`);
    this.addSql(`alter table "career_timeline_entries" drop column "location";`);
  }

}
