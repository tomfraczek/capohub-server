import { Migration } from '@mikro-orm/migrations';

// Splits "a user's rank" cleanly into two unrelated concepts (see the
// module spec revision: "CustomUserRank nie jest formalnym stopniem i nie
// może trafiać do historii kariery"):
//  - formal_rank_assignments (replaces user_rank_assignments) - always a
//    catalog Rank, required `rank_id`/`source_group_id` (no more nullable
//    "custom" branch, no more XOR check - there is only one kind of row
//    now). MikroORM's schema diff represents this as drop-old/create-new
//    rather than a semantic rename since the shape changed (customRank
//    column removed, two columns became NOT NULL) - functionally
//    equivalent here since the table was empty (see below).
//  - custom_user_ranks gains `is_active` (+ a partial unique index
//    guaranteeing at most one active cordão per user) - it is now fully
//    decoupled from any "assignment"/history table; nothing references it
//    by FK any more.
// Purely additive/restructuring, no data reinterpretation needed:
// user_rank_assignments and custom_user_ranks were both empty in every
// environment this migration will run against (the graduation module was
// added in the immediately preceding migration and never shipped with
// real user data), so this has no dedicated .itest.ts.
export class Migration20260806111603_RestructureFormalRankAssignment extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "formal_rank_assignments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "rank_id" uuid not null, "source_group_id" uuid not null, "started_on" date null, "ended_on" date null, "awarded_by_name" varchar(150) null, constraint "formal_rank_assignments_pkey" primary key ("id"), constraint formal_rank_assignments_ended_on_after_started_on_check check ("started_on" is null or "ended_on" is null or "ended_on" >= "started_on"));`);
    this.addSql(`create index "formal_rank_assignments_user_id_index" on "formal_rank_assignments" ("user_id");`);
    this.addSql(`create index "formal_rank_assignments_rank_id_index" on "formal_rank_assignments" ("rank_id");`);
    this.addSql(`create index "formal_rank_assignments_source_group_id_index" on "formal_rank_assignments" ("source_group_id");`);
    this.addSql(`create unique index "formal_rank_assignments_user_id_active_unique" on public.formal_rank_assignments ("user_id") where ("ended_on" is null);`);

    this.addSql(`alter table "formal_rank_assignments" add constraint "formal_rank_assignments_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "formal_rank_assignments" add constraint "formal_rank_assignments_rank_id_foreign" foreign key ("rank_id") references "ranks" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "formal_rank_assignments" add constraint "formal_rank_assignments_source_group_id_foreign" foreign key ("source_group_id") references "groups" ("id") on update cascade on delete no action;`);

    this.addSql(`drop table if exists "user_rank_assignments" cascade;`);

    this.addSql(`alter table "custom_user_ranks" add column "is_active" boolean not null default false;`);
    this.addSql(`create unique index "custom_user_ranks_user_id_active_unique" on public.custom_user_ranks ("user_id") where ("is_active" is true);`);
  }

  override async down(): Promise<void> {
    this.addSql(`create table "user_rank_assignments" ("id" uuid not null, "created_at" timestamptz(6) not null, "updated_at" timestamptz(6) not null, "user_id" uuid not null, "catalog_rank_id" uuid null, "custom_rank_id" uuid null, "source_group_id" uuid null, "started_on" date null, "ended_on" date null, "awarded_by_name" varchar(150) null, constraint "user_rank_assignments_pkey" primary key ("id"), constraint user_rank_assignments_catalog_xor_custom_check check (((catalog_rank_id IS NOT NULL) AND (custom_rank_id IS NULL) AND (source_group_id IS NOT NULL)) OR ((catalog_rank_id IS NULL) AND (custom_rank_id IS NOT NULL) AND (source_group_id IS NULL))), constraint user_rank_assignments_ended_on_after_started_on_check check ((started_on IS NULL) OR (ended_on IS NULL) OR (ended_on >= started_on)));`);
    this.addSql(`create index "user_rank_assignments_catalog_rank_id_index" on "user_rank_assignments" ("catalog_rank_id");`);
    this.addSql(`create index "user_rank_assignments_custom_rank_id_index" on "user_rank_assignments" ("custom_rank_id");`);
    this.addSql(`create index "user_rank_assignments_source_group_id_index" on "user_rank_assignments" ("source_group_id");`);
    this.addSql(`CREATE UNIQUE INDEX user_rank_assignments_user_id_active_unique ON public.user_rank_assignments USING btree (user_id) WHERE (ended_on IS NULL);`);
    this.addSql(`create index "user_rank_assignments_user_id_index" on "user_rank_assignments" ("user_id");`);

    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_catalog_rank_id_foreign" foreign key ("catalog_rank_id") references "ranks" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_custom_rank_id_foreign" foreign key ("custom_rank_id") references "custom_user_ranks" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_source_group_id_foreign" foreign key ("source_group_id") references "groups" ("id") on update cascade on delete no action;`);
    this.addSql(`alter table "user_rank_assignments" add constraint "user_rank_assignments_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`drop table if exists "formal_rank_assignments" cascade;`);

    this.addSql(`alter table "custom_user_ranks" drop constraint "custom_user_ranks_user_id_active_unique";`);
    this.addSql(`alter table "custom_user_ranks" drop column "is_active";`);
  }

}
