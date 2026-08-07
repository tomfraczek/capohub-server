import { Migration } from '@mikro-orm/migrations';

// Adds the career-timeline module (see career-timeline-aggregation.service.ts):
// aggregates a capoeirista's career history from EXISTING tables at read
// time (User.capoeira_started_at, formal_group_affiliations,
// formal_rank_assignments, event_attendees) - this migration does NOT
// create any table to hold that aggregate, only:
//  - career_timeline_entries: the ONLY persisted timeline data, manual
//    user-authored entries (category is always CUSTOM, never a column here
//    - see the entity's own comment).
//  - three new User privacy toggles (show_formal_rank,
//    show_career_timeline, show_event_participation), same plain-boolean
//    convention as the existing show_* columns.
//  - an optional formal_rank_assignments.event_id evidence link to the
//    Event a rank was received at (see FormalRankService.setCurrent) -
//    nullable, most historical ranks will never set it.
// Purely additive, no data reinterpretation - no dedicated .itest.ts, same
// precedent as the graduation module's own prior migrations.
export class Migration20260806132755_AddCareerTimeline extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "career_timeline_entries" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "occurred_on" date not null, "title" varchar(200) not null, "description" text null, constraint "career_timeline_entries_pkey" primary key ("id"));`);
    this.addSql(`create index "career_timeline_entries_user_id_index" on "career_timeline_entries" ("user_id");`);

    this.addSql(`alter table "career_timeline_entries" add constraint "career_timeline_entries_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "users" add column "show_formal_rank" boolean not null default false, add column "show_career_timeline" boolean not null default false, add column "show_event_participation" boolean not null default false;`);

    this.addSql(`alter table "formal_rank_assignments" add column "event_id" uuid null;`);
    this.addSql(`alter table "formal_rank_assignments" add constraint "formal_rank_assignments_event_id_foreign" foreign key ("event_id") references "events" ("id") on update cascade on delete no action;`);
    this.addSql(`create index "formal_rank_assignments_event_id_index" on "formal_rank_assignments" ("event_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "career_timeline_entries" cascade;`);

    this.addSql(`alter table "formal_rank_assignments" drop constraint "formal_rank_assignments_event_id_foreign";`);

    this.addSql(`drop index "formal_rank_assignments_event_id_index";`);
    this.addSql(`alter table "formal_rank_assignments" drop column "event_id";`);

    this.addSql(`alter table "users" drop column "show_formal_rank", drop column "show_career_timeline", drop column "show_event_participation";`);
  }

}
