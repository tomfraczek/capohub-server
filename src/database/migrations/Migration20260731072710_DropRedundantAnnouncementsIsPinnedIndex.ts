import { Migration } from '@mikro-orm/migrations';

// Drops the standalone `announcements_is_pinned_index` - structurally
// redundant with `announcements_is_pinned_created_at_index` (isPinned,
// createdAt), whose leading column already serves any query that would
// otherwise want a plain `is_pinned` index. Confirmed via EXPLAIN ANALYZE
// against a 125k-row synthetic dataset that every real query shape this
// module issues (list/archive/Home, all ordered by isPinned desc,
// createdAt desc) is served by the composite index; `idx_scan` on the
// standalone index stayed at 0 across all of them (see
// announcement.entity.ts's own comment on `isPinned`).
export class Migration20260731072710_DropRedundantAnnouncementsIsPinnedIndex extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index "announcements_is_pinned_index";`);
  }

  override async down(): Promise<void> {
    this.addSql(
      `create index "announcements_is_pinned_index" on "announcements" ("is_pinned");`,
    );
  }
}
