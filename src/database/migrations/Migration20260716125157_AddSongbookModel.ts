import { Migration } from '@mikro-orm/migrations';

export class Migration20260716125157_AddSongbookModel extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "song_categories" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "code" varchar(50) not null, "name" varchar(100) not null, "position" int not null, "is_active" boolean not null default true, constraint "song_categories_pkey" primary key ("id"));`);
    this.addSql(`alter table "song_categories" add constraint "song_categories_code_unique" unique ("code");`);

    this.addSql(`insert into "song_categories" ("id", "created_at", "updated_at", "code", "name", "position", "is_active") values
      (gen_random_uuid(), now(), now(), 'LADAINHA', 'Ladainha', 1, true),
      (gen_random_uuid(), now(), now(), 'CHULA', 'Chula', 2, true),
      (gen_random_uuid(), now(), now(), 'CORRIDO', 'Corrido', 3, true),
      (gen_random_uuid(), now(), now(), 'QUADRA', 'Quadra', 4, true),
      (gen_random_uuid(), now(), now(), 'MACULELE', 'Maculelê', 5, true),
      (gen_random_uuid(), now(), now(), 'SAMBA_DE_RODA', 'Samba de roda', 6, true),
      (gen_random_uuid(), now(), now(), 'HINO', 'Hino', 7, true),
      (gen_random_uuid(), now(), now(), 'OTHER', 'Inna', 8, true)
    on conflict ("code") do nothing;`);

    this.addSql(`create table "tags" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(100) not null, "slug" varchar(120) not null, "is_active" boolean not null default true, constraint "tags_pkey" primary key ("id"));`);
    this.addSql(`alter table "tags" add constraint "tags_name_unique" unique ("name");`);
    this.addSql(`alter table "tags" add constraint "tags_slug_unique" unique ("slug");`);

    this.addSql(`create table "songs" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "title" varchar(200) not null, "slug" varchar(250) not null, "author_name" varchar(150) null, "status" text check ("status" in ('DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'HIDDEN')) not null default 'DRAFT', "meaning_history" text null, "meaning_context" text null, "meaning_trivia" text null, "category_id" uuid not null, "created_by_id" uuid null, constraint "songs_pkey" primary key ("id"));`);
    this.addSql(`create index "songs_title_index" on "songs" ("title");`);
    this.addSql(`alter table "songs" add constraint "songs_slug_unique" unique ("slug");`);
    this.addSql(`create index "songs_status_index" on "songs" ("status");`);
    this.addSql(`create index "songs_category_id_index" on "songs" ("category_id");`);
    this.addSql(`create index "songs_created_by_id_index" on "songs" ("created_by_id");`);
    this.addSql(`create index "songs_created_at_index" on "songs" ("created_at");`);

    this.addSql(`create table "song_tags" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "tag_id" uuid not null, constraint "song_tags_pkey" primary key ("id"));`);
    this.addSql(`create index "song_tags_tag_id_index" on "song_tags" ("tag_id");`);
    this.addSql(`alter table "song_tags" add constraint "song_tags_song_id_tag_id_unique" unique ("song_id", "tag_id");`);

    this.addSql(`create table "song_parts" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "performer" text check ("performer" in ('LEAD', 'CHORUS')) not null, "position" int not null, constraint "song_parts_pkey" primary key ("id"));`);
    this.addSql(`alter table "song_parts" add constraint "song_parts_song_id_position_unique" unique ("song_id", "position");`);

    this.addSql(`create table "song_lines" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "part_id" uuid not null, "original_text" text not null, "phonetic_text" text null, "position" int not null, constraint "song_lines_pkey" primary key ("id"));`);
    this.addSql(`alter table "song_lines" add constraint "song_lines_part_id_position_unique" unique ("part_id", "position");`);

    this.addSql(`create table "song_line_translations" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "line_id" uuid not null, "language_code" varchar(10) not null, "text" text not null, constraint "song_line_translations_pkey" primary key ("id"));`);
    this.addSql(`create index "song_line_translations_language_code_index" on "song_line_translations" ("language_code");`);
    this.addSql(`alter table "song_line_translations" add constraint "song_line_translations_line_id_language_code_unique" unique ("line_id", "language_code");`);

    this.addSql(`create table "song_media" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "provider" text check ("provider" in ('YOUTUBE', 'SPOTIFY', 'SOUNDCLOUD')) not null, "url" varchar(2048) not null, "title" varchar(200) null, "position" int not null, "created_by_id" uuid null, constraint "song_media_pkey" primary key ("id"));`);
    this.addSql(`create index "song_media_song_id_index" on "song_media" ("song_id");`);
    this.addSql(`create index "song_media_provider_index" on "song_media" ("provider");`);
    this.addSql(`create index "song_media_created_by_id_index" on "song_media" ("created_by_id");`);
    this.addSql(`alter table "song_media" add constraint "song_media_song_id_url_unique" unique ("song_id", "url");`);

    this.addSql(`create table "song_alternative_titles" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "title" varchar(200) not null, "position" int not null, constraint "song_alternative_titles_pkey" primary key ("id"));`);
    this.addSql(`create index "song_alternative_titles_title_index" on "song_alternative_titles" ("title");`);
    this.addSql(`alter table "song_alternative_titles" add constraint "song_alternative_titles_song_id_title_unique" unique ("song_id", "title");`);

    this.addSql(`alter table "songs" add constraint "songs_category_id_foreign" foreign key ("category_id") references "song_categories" ("id") on update cascade;`);
    this.addSql(`alter table "songs" add constraint "songs_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "song_tags" add constraint "song_tags_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_tags" add constraint "song_tags_tag_id_foreign" foreign key ("tag_id") references "tags" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "song_parts" add constraint "song_parts_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "song_lines" add constraint "song_lines_part_id_foreign" foreign key ("part_id") references "song_parts" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "song_line_translations" add constraint "song_line_translations_line_id_foreign" foreign key ("line_id") references "song_lines" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "song_media" add constraint "song_media_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_media" add constraint "song_media_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "song_alternative_titles" add constraint "song_alternative_titles_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "songs" drop constraint "songs_category_id_foreign";`);

    this.addSql(`alter table "song_tags" drop constraint "song_tags_tag_id_foreign";`);

    this.addSql(`alter table "song_tags" drop constraint "song_tags_song_id_foreign";`);

    this.addSql(`alter table "song_parts" drop constraint "song_parts_song_id_foreign";`);

    this.addSql(`alter table "song_media" drop constraint "song_media_song_id_foreign";`);

    this.addSql(`alter table "song_alternative_titles" drop constraint "song_alternative_titles_song_id_foreign";`);

    this.addSql(`alter table "song_lines" drop constraint "song_lines_part_id_foreign";`);

    this.addSql(`alter table "song_line_translations" drop constraint "song_line_translations_line_id_foreign";`);

    this.addSql(`drop table if exists "song_categories" cascade;`);

    this.addSql(`drop table if exists "tags" cascade;`);

    this.addSql(`drop table if exists "songs" cascade;`);

    this.addSql(`drop table if exists "song_tags" cascade;`);

    this.addSql(`drop table if exists "song_parts" cascade;`);

    this.addSql(`drop table if exists "song_lines" cascade;`);

    this.addSql(`drop table if exists "song_line_translations" cascade;`);

    this.addSql(`drop table if exists "song_media" cascade;`);

    this.addSql(`drop table if exists "song_alternative_titles" cascade;`);
  }

}
