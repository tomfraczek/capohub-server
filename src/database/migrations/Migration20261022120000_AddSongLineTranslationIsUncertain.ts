import { Migration } from '@mikro-orm/migrations';

// Per-translation uncertainty flag (see song-line-translation.entity.ts).
// Purely additive: every existing translation is backfilled as certain
// (false) by the column default, and older clients that never send the
// field keep working - see SongContentService.replaceContent for how an
// omitted flag is resolved on write.
export class Migration20261022120000_AddSongLineTranslationIsUncertain extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "song_line_translations" add column "is_uncertain" boolean not null default false;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "song_line_translations" drop column "is_uncertain";`);
  }

}
