import { Migration } from '@mikro-orm/migrations';

// Turns CustomUserRank from a list-with-one-active-flag model into a true
// singleton - at most one row per user, full stop (see
// custom-user-rank.entity.ts's rewritten comment). `isActive` and its
// partial unique index (custom_user_ranks_user_id_active_unique) are
// replaced by a plain unique constraint on user_id
// (custom_user_ranks_user_id_unique).
//
// Production data for this table is unknown to us (a local read-only
// check found only 2 rows / 2 distinct users / no duplicates, but that is
// not a guarantee for every environment), so `up()` runs a defensive
// data-safety pass BEFORE the schema change, in two steps:
//  1. For a user with multiple rows where exactly one is active (the
//     ordinary case - the old partial unique index already guarantees at
//     most one active row per user), the non-active duplicates are
//     deleted, keeping the active one. Child
//     custom_user_rank_cord_segments rows cascade automatically (that FK
//     is `on delete cascade` - see custom-user-rank-cord-segment.entity.ts
//     and the original AddGraduationCatalog migration).
//  2. For a user *still* left with multiple rows after that (duplicates
//     where none was active - the genuinely ambiguous case), this
//     deliberately does NOT guess a winner via an arbitrary tie-break.
//     Per product requirement, those rows are instead copied into a new
//     `custom_user_ranks_migration_backup` table and then deleted from
//     `custom_user_ranks`, leaving that user with zero independent rank
//     rows - recoverably archived rather than silently resolved.
//
// `down()` only reverses the schema change (re-adds `is_active` default
// false, drops the plain unique constraint, recreates the old partial
// unique index) - the data-cleanup/backup step above is one-way and is
// NOT undone by `down()`. Rows moved into
// custom_user_ranks_migration_backup stay there (and are not
// automatically restored into custom_user_ranks) even after a rollback.
export class Migration20260922100000_MakeCustomUserRankSingleton extends Migration {

  override async up(): Promise<void> {
    // Step 1: exactly one active row among the duplicates for a user -
    // keep it, delete the rest.
    this.addSql(`
      delete from "custom_user_ranks" cur
      using (
        select "user_id"
        from "custom_user_ranks"
        group by "user_id"
        having count(*) > 1 and count(*) filter (where "is_active") = 1
      ) dup
      where cur."user_id" = dup."user_id"
        and cur."is_active" = false;
    `);

    // Step 2: any user still left with multiple rows at this point has
    // duplicates with no active row to prefer - archive them rather than
    // picking one at random (deliberate, per product requirement: no
    // random tie-break).
    this.addSql(`
      create table "custom_user_ranks_migration_backup" as
      select * from "custom_user_ranks" where 1 = 0;
    `);
    this.addSql(`
      insert into "custom_user_ranks_migration_backup"
      select cur.*
      from "custom_user_ranks" cur
      join (
        select "user_id"
        from "custom_user_ranks"
        group by "user_id"
        having count(*) > 1
      ) dup on dup."user_id" = cur."user_id";
    `);
    this.addSql(`
      delete from "custom_user_ranks" cur
      using (
        select "user_id"
        from "custom_user_ranks"
        group by "user_id"
        having count(*) > 1
      ) dup
      where cur."user_id" = dup."user_id";
    `);

    // Schema change: drop the old partial-active unique index and column,
    // add the new plain per-user unique constraint. Every remaining row is
    // now guaranteed at most one per user (steps 1-2 above), so this
    // cannot fail.
    this.addSql(`drop index "custom_user_ranks_user_id_active_unique";`);
    this.addSql(`alter table "custom_user_ranks" drop column "is_active";`);
    this.addSql(`alter table "custom_user_ranks" add constraint "custom_user_ranks_user_id_unique" unique ("user_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "custom_user_ranks" drop constraint "custom_user_ranks_user_id_unique";`);
    this.addSql(`alter table "custom_user_ranks" add column "is_active" boolean not null default false;`);
    this.addSql(`create unique index "custom_user_ranks_user_id_active_unique" on public.custom_user_ranks ("user_id") where ("is_active" is true);`);
    // Deliberately not reversed: custom_user_ranks_migration_backup (if it
    // was created) and the rows archived into it are left as-is - see this
    // file's own top comment.
  }

}
