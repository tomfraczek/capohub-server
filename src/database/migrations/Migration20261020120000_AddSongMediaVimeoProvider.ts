import { Migration } from '@mikro-orm/migrations';

// Adds VIMEO to SongMediaProvider (see song-media-provider.enum.ts and the
// matching host allowlist in song-media-domains.ts). Purely additive - every
// existing row already satisfies the widened check, so no data guard is
// needed on the way up.
export class Migration20261020120000_AddSongMediaVimeoProvider extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "song_media" drop constraint if exists "song_media_provider_check";`);
    this.addSql(`alter table "song_media" add constraint "song_media_provider_check" check("provider" in ('YOUTUBE', 'SPOTIFY', 'SOUNDCLOUD', 'VIMEO'));`);
  }

  // Fails (by design) while any VIMEO media row still exists - those rows
  // must be removed or re-typed manually before rolling back.
  override async down(): Promise<void> {
    this.addSql(`alter table "song_media" drop constraint if exists "song_media_provider_check";`);
    this.addSql(`alter table "song_media" add constraint "song_media_provider_check" check("provider" in ('YOUTUBE', 'SPOTIFY', 'SOUNDCLOUD'));`);
  }

}
