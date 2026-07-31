import { Migration } from '@mikro-orm/migrations';

// Completes the Announcement lifecycle model: `deletedAt` (deliberate
// withdrawal, distinct from natural expiry - see announcement.entity.ts)
// and `editedAt` (set only by a real content edit through PATCH, never
// derived from the generic `updatedAt`), plus an explicit `readAt` on
// AnnouncementRead (previously read off `createdAt` under another name -
// see announcement-read.entity.ts).
export class Migration20260730140306_AddAnnouncementLifecycleFields extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "announcements" add column "deleted_at" timestamptz null, add column "edited_at" timestamptz null;`,
    );
    // Every list-shaped read path filters on `deleted_at IS NULL`
    // unconditionally (see AnnouncementsService.buildVisibilityFilter) -
    // indexed so that filter stays cheap regardless of table size.
    this.addSql(
      `create index "announcements_deleted_at_index" on "announcements" ("deleted_at");`,
    );

    // `not null` - every row (existing or new) gets a value: this table
    // only ever gains rows through AnnouncementsService.markRead, which
    // always sets `readAt` explicitly (see its own comment) - there is no
    // path that creates an AnnouncementRead without one.
    this.addSql(
      `alter table "announcement_reads" add column "read_at" timestamptz not null default now();`,
    );
    this.addSql(
      `alter table "announcement_reads" alter column "read_at" drop default;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "announcement_reads" drop column "read_at";`);

    this.addSql(`drop index "announcements_deleted_at_index";`);
    this.addSql(
      `alter table "announcements" drop column "deleted_at", drop column "edited_at";`,
    );
  }
}
