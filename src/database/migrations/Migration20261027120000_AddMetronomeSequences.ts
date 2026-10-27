import { Migration } from '@mikro-orm/migrations';

// Sequences from the app's metronome (Instrumenty mode), until now kept
// only on the device. New table, nothing to backfill: sequences already on
// a device are uploaded by the app on its next sync, as private.
export class Migration20261027120000_AddMetronomeSequences extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "metronome_sequences" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "owner_id" uuid not null, "title" varchar(80) not null, "instrument" text check ("instrument" in ('agogo', 'atabaque')) not null, "bpm" smallint not null, "division" smallint not null, "steps" jsonb not null, "visibility" text check ("visibility" in ('private', 'public')) not null default 'private', "copied_from_id" uuid null, "original_author_id" uuid null, constraint "metronome_sequences_pkey" primary key ("id"));`);
    this.addSql(`create index "metronome_sequences_owner_id_index" on "metronome_sequences" ("owner_id");`);
    this.addSql(`create index "metronome_sequences_visibility_updated_at_index" on "metronome_sequences" ("visibility", "updated_at");`);

    this.addSql(`alter table "metronome_sequences" add constraint "metronome_sequences_owner_id_foreign" foreign key ("owner_id") references "users" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "metronome_sequences" add constraint "metronome_sequences_copied_from_id_foreign" foreign key ("copied_from_id") references "metronome_sequences" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "metronome_sequences" add constraint "metronome_sequences_original_author_id_foreign" foreign key ("original_author_id") references "users" ("id") on update cascade on delete set null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "metronome_sequences" cascade;`);
  }

}
