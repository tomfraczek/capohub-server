import { Migration } from '@mikro-orm/migrations';

// 1. custom_user_ranks becomes period-based (started_on/ended_on), like
//    formal_rank_assignments: the plain one-row-per-user unique constraint
//    becomes a partial unique index over the *active* row only, so a
//    replaced independent rank stays as history instead of being
//    overwritten (see custom-user-rank.entity.ts).
// 2. formal_rank_requests - a formal rank only takes effect once someone
//    authorized in the Group confirms it (see formal-rank-request.entity.ts).
// 3. Data: a user now has at most one active rank (formal or independent).
//    Where both are active today, the one the app currently shows is kept
//    and the other is ended today - the app showed the formal one exactly
//    while the user had an active formal Group, otherwise the independent
//    one. Nothing is deleted.
export class Migration20261006120000_AddFormalRankRequestsAndIndependentRankHistory extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "custom_user_ranks" add column "started_on" date null, add column "ended_on" date null;`);
    this.addSql(`alter table "custom_user_ranks" drop constraint "custom_user_ranks_user_id_unique";`);
    this.addSql(`create unique index "custom_user_ranks_user_id_active_unique" on "custom_user_ranks" ("user_id") where ("ended_on" is null);`);

    this.addSql(`create table "formal_rank_requests" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "group_id" uuid not null, "rank_id" uuid not null, "started_on" date null, "awarded_by_name" varchar(150) null, "event_id" uuid null, "status" text check ("status" in ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED')) not null default 'PENDING', "decided_at" timestamptz null, "decided_by_id" uuid null, constraint "formal_rank_requests_pkey" primary key ("id"));`);
    this.addSql(`create index "formal_rank_requests_user_id_index" on "formal_rank_requests" ("user_id");`);
    this.addSql(`create index "formal_rank_requests_group_id_index" on "formal_rank_requests" ("group_id");`);
    this.addSql(`create index "formal_rank_requests_status_index" on "formal_rank_requests" ("status");`);
    this.addSql(`create unique index "formal_rank_requests_user_id_pending_unique" on "formal_rank_requests" ("user_id") where ("status" = 'PENDING');`);
    this.addSql(`alter table "formal_rank_requests" add constraint "formal_rank_requests_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "formal_rank_requests" add constraint "formal_rank_requests_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade;`);
    this.addSql(`alter table "formal_rank_requests" add constraint "formal_rank_requests_rank_id_foreign" foreign key ("rank_id") references "ranks" ("id") on update cascade;`);
    this.addSql(`alter table "formal_rank_requests" add constraint "formal_rank_requests_event_id_foreign" foreign key ("event_id") references "events" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "formal_rank_requests" add constraint "formal_rank_requests_decided_by_id_foreign" foreign key ("decided_by_id") references "users" ("id") on update cascade on delete set null;`);

    // 3. One active rank per user - keep the one the app shows today.
    this.addSql(`update "custom_user_ranks" c set "ended_on" = current_date
      where c."ended_on" is null
        and exists (select 1 from "formal_rank_assignments" f where f."user_id" = c."user_id" and f."ended_on" is null)
        and exists (select 1 from "formal_group_affiliations" a where a."user_id" = c."user_id" and a."ended_on" is null);`);
    this.addSql(`update "formal_rank_assignments" f set "ended_on" = greatest(current_date, coalesce(f."started_on", current_date))
      where f."ended_on" is null
        and exists (select 1 from "custom_user_ranks" c where c."user_id" = f."user_id" and c."ended_on" is null)
        and not exists (select 1 from "formal_group_affiliations" a where a."user_id" = f."user_id" and a."ended_on" is null);`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "formal_rank_requests" cascade;`);

    // Back to one row per user: keep only each user's active (else newest)
    // independent rank.
    this.addSql(`delete from "custom_user_rank_cord_segments" s using "custom_user_ranks" c
      where s."custom_rank_id" = c."id" and c."ended_on" is not null
        and exists (select 1 from "custom_user_ranks" o where o."user_id" = c."user_id" and o."ended_on" is null);`);
    this.addSql(`delete from "custom_user_ranks" c where c."ended_on" is not null
      and exists (select 1 from "custom_user_ranks" o where o."user_id" = c."user_id" and o."ended_on" is null);`);
    this.addSql(`drop index "custom_user_ranks_user_id_active_unique";`);
    this.addSql(`alter table "custom_user_ranks" drop column "started_on", drop column "ended_on";`);
    this.addSql(`alter table "custom_user_ranks" add constraint "custom_user_ranks_user_id_unique" unique ("user_id");`);
  }

}
