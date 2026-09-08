import { Migration } from '@mikro-orm/migrations';

// "sections.cover_image_key" - Section's own real, R2-backed cover image
// (module: "zbuduj pełne tło sekcji od zera") - mirrors Group's own
// coverImageKey exactly (see Group.coverImageKey / GroupsService.
// uploadCoverImage). Section's coverImageUrl column already existed but
// was decorative-only until now (no upload endpoint, never rendered) - see
// this feature's own report.
export class Migration20260908114825_AddSectionCoverImageKey extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "sections" add column "cover_image_key" varchar(512) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "sections" drop column "cover_image_key";`);
  }

}
