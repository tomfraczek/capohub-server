import { Migration } from '@mikro-orm/migrations';

export class Migration20260717190144_AddUserSongLibraryAndPlaylists extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "song_notes" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "song_id" uuid not null, "content" text not null, constraint "song_notes_pkey" primary key ("id"));`);
    this.addSql(`create index "song_notes_user_id_index" on "song_notes" ("user_id");`);
    this.addSql(`create index "song_notes_song_id_index" on "song_notes" ("song_id");`);
    this.addSql(`alter table "song_notes" add constraint "song_notes_user_id_song_id_unique" unique ("user_id", "song_id");`);

    this.addSql(`create table "playlists" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "owner_id" uuid not null, "name" varchar(150) not null, "description" text null, constraint "playlists_pkey" primary key ("id"));`);
    this.addSql(`create index "playlists_owner_id_index" on "playlists" ("owner_id");`);

    this.addSql(`create table "playlist_songs" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "playlist_id" uuid not null, "song_id" uuid not null, "position" int not null, constraint "playlist_songs_pkey" primary key ("id"));`);
    this.addSql(`create index "playlist_songs_playlist_id_index" on "playlist_songs" ("playlist_id");`);
    this.addSql(`create index "playlist_songs_song_id_index" on "playlist_songs" ("song_id");`);
    this.addSql(`alter table "playlist_songs" add constraint "playlist_songs_playlist_id_song_id_unique" unique ("playlist_id", "song_id");`);

    this.addSql(`create table "favorite_songs" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "song_id" uuid not null, constraint "favorite_songs_pkey" primary key ("id"));`);
    this.addSql(`create index "favorite_songs_user_id_index" on "favorite_songs" ("user_id");`);
    this.addSql(`create index "favorite_songs_song_id_index" on "favorite_songs" ("song_id");`);
    this.addSql(`alter table "favorite_songs" add constraint "favorite_songs_user_id_song_id_unique" unique ("user_id", "song_id");`);

    this.addSql(`create table "user_song_learnings" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "user_id" uuid not null, "song_id" uuid not null, "status" text check ("status" in ('NOT_STARTED', 'LEARNING', 'TO_REVIEW', 'MASTERED', 'CAN_LEAD')) not null default 'NOT_STARTED', constraint "user_song_learnings_pkey" primary key ("id"));`);
    this.addSql(`create index "user_song_learnings_user_id_index" on "user_song_learnings" ("user_id");`);
    this.addSql(`create index "user_song_learnings_song_id_index" on "user_song_learnings" ("song_id");`);
    this.addSql(`alter table "user_song_learnings" add constraint "user_song_learnings_user_id_song_id_unique" unique ("user_id", "song_id");`);

    this.addSql(`alter table "song_notes" add constraint "song_notes_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_notes" add constraint "song_notes_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "playlists" add constraint "playlists_owner_id_foreign" foreign key ("owner_id") references "users" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "playlist_songs" add constraint "playlist_songs_playlist_id_foreign" foreign key ("playlist_id") references "playlists" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "playlist_songs" add constraint "playlist_songs_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "favorite_songs" add constraint "favorite_songs_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "favorite_songs" add constraint "favorite_songs_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "user_song_learnings" add constraint "user_song_learnings_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "user_song_learnings" add constraint "user_song_learnings_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "playlist_songs" drop constraint "playlist_songs_playlist_id_foreign";`);

    this.addSql(`drop table if exists "song_notes" cascade;`);

    this.addSql(`drop table if exists "playlists" cascade;`);

    this.addSql(`drop table if exists "playlist_songs" cascade;`);

    this.addSql(`drop table if exists "favorite_songs" cascade;`);

    this.addSql(`drop table if exists "user_song_learnings" cascade;`);
  }

}
