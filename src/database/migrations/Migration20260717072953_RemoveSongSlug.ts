import { Migration } from '@mikro-orm/migrations';

export class Migration20260717072953_RemoveSongSlug extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "songs" drop constraint "songs_slug_unique";`);
    this.addSql(`alter table "songs" drop column "slug";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "songs" add column "slug" varchar(250) not null;`);
    this.addSql(`alter table "songs" add constraint "songs_slug_unique" unique ("slug");`);
  }

}
