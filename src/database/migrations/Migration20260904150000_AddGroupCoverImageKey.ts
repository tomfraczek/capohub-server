import { Migration } from '@mikro-orm/migrations';

// Adds the real R2 cover-image upload for Group (PUT/DELETE
// /groups/:id/cover-image, see GroupsService.uploadCoverImage) - until now
// Group's coverImageUrl was a plain legacy string field with no upload
// endpoint behind it at all (the mobile picker was decorative-only, see
// ImageUrlPickerField's own comment), so "adding a cover photo" silently
// did nothing. Same profileImageKey-vs-logoUrl precedence pattern as
// Migration20260824101513_AddImageStorageKeys, just for the cover image.
// Section keeps no cover upload - not part of this change.
export class Migration20260904150000_AddGroupCoverImageKey extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "cover_image_key" varchar(512) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" drop column "cover_image_key";`);
  }

}
