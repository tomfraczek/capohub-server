import { Migration } from '@mikro-orm/migrations';

export class Migration20260718112046_AddMusicModuleInstrumentsAndRhythms extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "instruments" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "slug" varchar(120) not null, "name" varchar(150) not null, "alternative_names" text[] not null, "short_description" varchar(300) null, "description" text null, "history" text null, "construction" text null, "how_to_play" text null, "role_in_bateria" text null, "display_order" int not null default 0, "is_active" boolean not null default true, constraint "instruments_pkey" primary key ("id"));`);
    this.addSql(`alter table "instruments" add constraint "instruments_slug_unique" unique ("slug");`);
    this.addSql(`create index "instruments_display_order_index" on "instruments" ("display_order");`);
    this.addSql(`create index "instruments_is_active_index" on "instruments" ("is_active");`);

    this.addSql(`create table "instrument_media" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "instrument_id" uuid not null, "type" text check ("type" in ('IMAGE', 'AUDIO', 'VIDEO', 'YOUTUBE')) not null, "url" varchar(2048) not null, "title" varchar(200) null, "description" text null, "display_order" int not null default 0, constraint "instrument_media_pkey" primary key ("id"));`);
    this.addSql(`create index "instrument_media_instrument_id_index" on "instrument_media" ("instrument_id");`);
    this.addSql(`alter table "instrument_media" add constraint "instrument_media_instrument_id_url_unique" unique ("instrument_id", "url");`);

    this.addSql(`create table "rhythms" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "slug" varchar(120) not null, "name" varchar(150) not null, "alternative_names" text[] not null, "short_description" varchar(300) null, "description" text null, "history" text null, "usage" text null, "character" text null, "tempo_description" varchar(300) null, "tempo_min_bpm" smallint null, "tempo_max_bpm" smallint null, "display_order" int not null default 0, "is_active" boolean not null default true, constraint "rhythms_pkey" primary key ("id"), constraint rhythms_check check (tempo_min_bpm is null or tempo_max_bpm is null or tempo_min_bpm <= tempo_max_bpm));`);
    this.addSql(`alter table "rhythms" add constraint "rhythms_slug_unique" unique ("slug");`);
    this.addSql(`create index "rhythms_display_order_index" on "rhythms" ("display_order");`);
    this.addSql(`create index "rhythms_is_active_index" on "rhythms" ("is_active");`);

    this.addSql(`create table "instrument_rhythms" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "instrument_id" uuid not null, "rhythm_id" uuid not null, "role_description" text null, "display_order" int not null default 0, constraint "instrument_rhythms_pkey" primary key ("id"));`);
    this.addSql(`create index "instrument_rhythms_instrument_id_index" on "instrument_rhythms" ("instrument_id");`);
    this.addSql(`create index "instrument_rhythms_rhythm_id_index" on "instrument_rhythms" ("rhythm_id");`);
    this.addSql(`alter table "instrument_rhythms" add constraint "instrument_rhythms_instrument_id_rhythm_id_unique" unique ("instrument_id", "rhythm_id");`);

    this.addSql(`create table "rhythm_media" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "rhythm_id" uuid not null, "type" text check ("type" in ('IMAGE', 'AUDIO', 'VIDEO', 'YOUTUBE')) not null, "url" varchar(2048) not null, "title" varchar(200) null, "description" text null, "display_order" int not null default 0, "instrument_id" uuid null, constraint "rhythm_media_pkey" primary key ("id"));`);
    this.addSql(`create index "rhythm_media_rhythm_id_index" on "rhythm_media" ("rhythm_id");`);
    this.addSql(`create index "rhythm_media_instrument_id_index" on "rhythm_media" ("instrument_id");`);
    this.addSql(`alter table "rhythm_media" add constraint "rhythm_media_rhythm_id_url_unique" unique ("rhythm_id", "url");`);

    this.addSql(`create table "song_rhythms" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "rhythm_id" uuid not null, "is_primary" boolean not null default false, "description" text null, constraint "song_rhythms_pkey" primary key ("id"));`);
    this.addSql(`create index "song_rhythms_song_id_index" on "song_rhythms" ("song_id");`);
    this.addSql(`create index "song_rhythms_rhythm_id_index" on "song_rhythms" ("rhythm_id");`);
    this.addSql(`alter table "song_rhythms" add constraint "song_rhythms_song_id_rhythm_id_unique" unique ("song_id", "rhythm_id");`);

    this.addSql(`alter table "instrument_media" add constraint "instrument_media_instrument_id_foreign" foreign key ("instrument_id") references "instruments" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "instrument_rhythms" add constraint "instrument_rhythms_instrument_id_foreign" foreign key ("instrument_id") references "instruments" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "instrument_rhythms" add constraint "instrument_rhythms_rhythm_id_foreign" foreign key ("rhythm_id") references "rhythms" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "rhythm_media" add constraint "rhythm_media_rhythm_id_foreign" foreign key ("rhythm_id") references "rhythms" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "rhythm_media" add constraint "rhythm_media_instrument_id_foreign" foreign key ("instrument_id") references "instruments" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "song_rhythms" add constraint "song_rhythms_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_rhythms" add constraint "song_rhythms_rhythm_id_foreign" foreign key ("rhythm_id") references "rhythms" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "instrument_media" drop constraint "instrument_media_instrument_id_foreign";`);

    this.addSql(`alter table "instrument_rhythms" drop constraint "instrument_rhythms_instrument_id_foreign";`);

    this.addSql(`alter table "rhythm_media" drop constraint "rhythm_media_instrument_id_foreign";`);

    this.addSql(`alter table "instrument_rhythms" drop constraint "instrument_rhythms_rhythm_id_foreign";`);

    this.addSql(`alter table "rhythm_media" drop constraint "rhythm_media_rhythm_id_foreign";`);

    this.addSql(`alter table "song_rhythms" drop constraint "song_rhythms_rhythm_id_foreign";`);

    this.addSql(`drop table if exists "instruments" cascade;`);

    this.addSql(`drop table if exists "instrument_media" cascade;`);

    this.addSql(`drop table if exists "rhythms" cascade;`);

    this.addSql(`drop table if exists "instrument_rhythms" cascade;`);

    this.addSql(`drop table if exists "rhythm_media" cascade;`);

    this.addSql(`drop table if exists "song_rhythms" cascade;`);
  }

}
