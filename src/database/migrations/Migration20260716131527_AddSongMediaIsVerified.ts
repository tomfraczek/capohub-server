import { Migration } from '@mikro-orm/migrations';

export class Migration20260716131527_AddSongMediaIsVerified extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "song_media" add column "is_verified" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "song_media" drop column "is_verified";`);
  }

}
