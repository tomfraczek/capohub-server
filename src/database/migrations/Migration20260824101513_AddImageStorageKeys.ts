import { Migration } from '@mikro-orm/migrations';

// "Cloudflare R2: upload/replace/delete zdjęć dla User/Group/Section/Event"
// module. Adds one nullable R2 object-key column per resource that gains an
// upload endpoint - see storage/object-keys.util.ts for the key shape each
// one holds, and each entity's own comment (user.entity.ts/group.entity.ts/
// section.entity.ts/event.entity.ts) for how it relates to that resource's
// pre-existing legacy URL column.
//
// Deliberately no backfill: an external URL (Group.logoUrl,
// Section.logoUrl, Event.coverImageUrl, User.avatarUrl) cannot be safely
// turned into an R2 object key - there is no R2 object behind it at all
// (module spec §39, "Nie backfilluj z legacy URL do objectKey"). Every one
// of these columns starts out entirely null and is only ever populated
// going forward, the first time each resource uses its new upload
// endpoint; the legacy URL column keeps rendering as a fallback until then
// (see storage/image-url.util.ts's resolveImageUrl/resolveUserAvatarUrl).
export class Migration20260824101513_AddImageStorageKeys extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `alter table "groups" add column "profile_image_key" varchar(512) null;`,
    );

    this.addSql(
      `alter table "sections" add column "profile_image_key" varchar(512) null;`,
    );

    this.addSql(
      `alter table "users" add column "avatar_image_key" varchar(512) null;`,
    );

    this.addSql(
      `alter table "events" add column "cover_image_key" varchar(512) null;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop column "cover_image_key";`);

    this.addSql(`alter table "groups" drop column "profile_image_key";`);

    this.addSql(`alter table "sections" drop column "profile_image_key";`);

    this.addSql(`alter table "users" drop column "avatar_image_key";`);
  }
}
