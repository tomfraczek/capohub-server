import { Migration } from '@mikro-orm/migrations';

export class Migration20260716183533_AddSongMediaVote extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "song_media_votes" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "media_id" uuid not null, "user_id" uuid not null, constraint "song_media_votes_pkey" primary key ("id"));`);
    this.addSql(`create index "song_media_votes_media_id_index" on "song_media_votes" ("media_id");`);
    this.addSql(`create index "song_media_votes_user_id_index" on "song_media_votes" ("user_id");`);
    this.addSql(`alter table "song_media_votes" add constraint "song_media_votes_song_id_user_id_unique" unique ("song_id", "user_id");`);

    this.addSql(`alter table "song_media_votes" add constraint "song_media_votes_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_media_votes" add constraint "song_media_votes_media_id_foreign" foreign key ("media_id") references "song_media" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_media_votes" add constraint "song_media_votes_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "song_media_votes" cascade;`);
  }

}
