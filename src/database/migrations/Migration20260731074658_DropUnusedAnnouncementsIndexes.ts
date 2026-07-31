import { Migration } from '@mikro-orm/migrations';

// Drops three single-column indexes confirmed unused by any real query in
// the Announcements module - re-verified via EXPLAIN ANALYZE against a
// 125k-row synthetic dataset (~5% deleted, ~5% RECIPIENT_GROUP, realistic
// 200-row snapshot for the RECIPIENT_GROUP $or branch), covering every
// real access path: list(), archive(), listForViewer() (Home), the
// single-row loadOrFail() used by getById/update/markRead, and remove().
//
//  - announcements_deleted_at_index: every query filters `deleted_at IS
//    NULL`, the overwhelming-majority case (deletion is meant to stay the
//    rare exception) - a btree index cannot help exclude the common case
//    cheaply, and Postgres never chose it (0 idx_scan). No "list deleted"
//    admin/trash view exists to query the opposite (`IS NOT NULL`).
//  - announcements_expires_at_index: always filtered alongside a more
//    selective `community` predicate or already served by the
//    (isPinned, createdAt) composite index's free ordering - never chosen
//    (0 idx_scan). No maintenance job scans purely by `expiresAt` (this
//    project deliberately has no cron/background status flip).
//  - announcements_recipient_type_index: only ever queried via `!=` (an
//    inequality a btree index cannot use) or, in the RECIPIENT_GROUP
//    equality branch, alongside an `id IN (...)` list that already
//    dominates the plan - never chosen (0 idx_scan).
export class Migration20260731074658_DropUnusedAnnouncementsIndexes extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index "announcements_deleted_at_index";`);
    this.addSql(`drop index "announcements_expires_at_index";`);
    this.addSql(`drop index "announcements_recipient_type_index";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `create index "announcements_deleted_at_index" on "announcements" ("deleted_at");`,
    );
    this.addSql(
      `create index "announcements_expires_at_index" on "announcements" ("expires_at");`,
    );
    this.addSql(
      `create index "announcements_recipient_type_index" on "announcements" ("recipient_type");`,
    );
  }
}
