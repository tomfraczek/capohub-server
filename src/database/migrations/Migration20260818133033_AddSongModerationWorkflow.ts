import { Migration } from '@mikro-orm/migrations';

// Adds the Song edit-moderation workflow (see song-edit-proposal.entity.ts
// and the moderation model report): a PUBLISHED/HIDDEN Song is no longer
// editable directly by anyone - every further change is a
// SongEditProposal, holding a full jsonb snapshot (never a diff, since
// Song's nested collections make diffing fragile - see that entity's own
// comment), that a moderator must approve before it is applied.
//  - song_edit_proposals: song_id/proposed_by_id/reviewed_by_id FKs,
//    status check constraint, and three indexes sized for how this table
//    is actually queried - by song (song_id, and song_id+status for the
//    per-song list), and for a future cross-song moderation queue
//    (status+created_at).
//  - songs.rejection_reason: nullable, purely additive - set by
//    SongsService.reject() on the original submission, cleared on the next
//    successful submit(); never touched by a SongEditProposal, which keeps
//    its own rejection_reason column instead.
// Purely additive - no existing songs data is touched.
export class Migration20260818133033_AddSongModerationWorkflow extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "song_edit_proposals" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "song_id" uuid not null, "proposed_by_id" uuid null, "status" text check ("status" in ('PENDING', 'APPROVED', 'REJECTED')) not null default 'PENDING', "payload" jsonb not null, "rejection_reason" text null, "reviewed_by_id" uuid null, "reviewed_at" timestamptz null, constraint "song_edit_proposals_pkey" primary key ("id"));`);
    this.addSql(`create index "song_edit_proposals_song_id_index" on "song_edit_proposals" ("song_id");`);
    this.addSql(`create index "song_edit_proposals_proposed_by_id_index" on "song_edit_proposals" ("proposed_by_id");`);
    this.addSql(`create index "song_edit_proposals_status_index" on "song_edit_proposals" ("status");`);
    this.addSql(`create index "song_edit_proposals_status_created_at_index" on "song_edit_proposals" ("status", "created_at");`);
    this.addSql(`create index "song_edit_proposals_song_id_status_index" on "song_edit_proposals" ("song_id", "status");`);

    this.addSql(`alter table "song_edit_proposals" add constraint "song_edit_proposals_song_id_foreign" foreign key ("song_id") references "songs" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "song_edit_proposals" add constraint "song_edit_proposals_proposed_by_id_foreign" foreign key ("proposed_by_id") references "users" ("id") on update cascade on delete set null;`);
    this.addSql(`alter table "song_edit_proposals" add constraint "song_edit_proposals_reviewed_by_id_foreign" foreign key ("reviewed_by_id") references "users" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "songs" add column "rejection_reason" text null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "song_edit_proposals" cascade;`);

    this.addSql(`alter table "songs" drop column "rejection_reason";`);
  }

}
