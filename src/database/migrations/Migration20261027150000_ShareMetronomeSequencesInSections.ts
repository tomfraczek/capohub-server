import { Migration } from '@mikro-orm/migrations';

// Metronome sequences are shared in Sections instead of a global public
// library: a many-to-many link table replaces the per-sequence visibility
// flag. Every sequence is kept; one that was "public" simply becomes
// private (there was no Section to carry it into) and its owner can share
// it in their Sections from now on.
export class Migration20261027150000_ShareMetronomeSequencesInSections extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "section_metronome_sequences" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "section_id" uuid not null, "sequence_id" uuid not null, "shared_by_id" uuid null, constraint "section_metronome_sequences_pkey" primary key ("id"));`);
    this.addSql(`create index "section_metronome_sequences_sequence_id_index" on "section_metronome_sequences" ("sequence_id");`);
    this.addSql(`create index "section_metronome_sequences_section_id_created_at_index" on "section_metronome_sequences" ("section_id", "created_at");`);
    this.addSql(`alter table "section_metronome_sequences" add constraint "section_metronome_sequences_section_id_sequence_id_unique" unique ("section_id", "sequence_id");`);

    this.addSql(`alter table "section_metronome_sequences" add constraint "section_metronome_sequences_section_id_foreign" foreign key ("section_id") references "sections" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "section_metronome_sequences" add constraint "section_metronome_sequences_sequence_id_foreign" foreign key ("sequence_id") references "metronome_sequences" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "section_metronome_sequences" add constraint "section_metronome_sequences_shared_by_id_foreign" foreign key ("shared_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`drop index if exists "metronome_sequences_visibility_updated_at_index";`);
    this.addSql(`alter table "metronome_sequences" drop column "visibility";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "metronome_sequences" add column "visibility" text check ("visibility" in ('private', 'public')) not null default 'private';`);
    this.addSql(`create index "metronome_sequences_visibility_updated_at_index" on "metronome_sequences" ("visibility", "updated_at");`);

    this.addSql(`drop table if exists "section_metronome_sequences" cascade;`);
  }

}
