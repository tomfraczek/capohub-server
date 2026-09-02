import { Migration } from '@mikro-orm/migrations';

// Replaces SongLine.phoneticText (a single flat column, "Portuguese
// phonetics attached directly to this line") with song_line_phonetics, one
// row per language a moderator/author has filled in - the exact same shape
// as the pre-existing song_line_translations table, since the same
// Portuguese line reads differently depending on the reader's own language.
//
// Every existing non-null phonetic_text value is migrated rather than
// dropped: it is carried forward under languageCode 'pt', matching the
// column's own original comment ("Portuguese phonetics") - the only
// language every existing row could possibly be, since the column never had
// a language dimension to read one from.
export class Migration20260902120000_AddSongLinePhonetics extends Migration {
  override async up(): Promise<void> {
    this.addSql(`
      create table "song_line_phonetics" (
        "id" uuid not null,
        "created_at" timestamptz not null,
        "updated_at" timestamptz not null,
        "line_id" uuid not null,
        "language_code" varchar(10) not null,
        "text" text not null,
        constraint "song_line_phonetics_pkey" primary key ("id")
      );
    `);
    this.addSql(
      `create index "song_line_phonetics_language_code_index" on "song_line_phonetics" ("language_code");`,
    );
    this.addSql(`
      alter table "song_line_phonetics" add constraint "song_line_phonetics_line_id_language_code_unique"
        unique ("line_id", "language_code");
    `);
    this.addSql(`
      alter table "song_line_phonetics" add constraint "song_line_phonetics_line_id_foreign"
        foreign key ("line_id") references "song_lines" ("id") on update cascade on delete cascade;
    `);

    // Data migration: every song_lines row with a non-blank phonetic_text
    // gets exactly one song_line_phonetics row, languageCode 'pt' (see the
    // class comment above for why 'pt' is the only safe, data-derived
    // choice here - never guessed per-row).
    this.addSql(`
      insert into "song_line_phonetics" ("id", "created_at", "updated_at", "line_id", "language_code", "text")
      select gen_random_uuid(), now(), now(), "id", 'pt', "phonetic_text"
      from "song_lines"
      where "phonetic_text" is not null and length(trim("phonetic_text")) > 0;
    `);

    this.addSql(`alter table "song_lines" drop column "phonetic_text";`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "song_lines" add column "phonetic_text" text null;`);
    // Best-effort recovery: a line with phonetics in more than one language
    // only had room for one flat value pre-migration, so only the 'pt' row
    // (the language every pre-migration value was under, per up() above)
    // is restored - any additional language added after this migration ran
    // has no pre-migration column to go back to and is simply dropped here
    // along with the table itself.
    this.addSql(`
      update "song_lines" sl set "phonetic_text" = slp."text"
      from "song_line_phonetics" slp
      where slp."line_id" = sl."id" and slp."language_code" = 'pt';
    `);
    this.addSql(`drop table "song_line_phonetics" cascade;`);
  }
}
