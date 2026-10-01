import { Migration } from '@mikro-orm/migrations';

// Adds Event.participantsVisibility (see event-participants-visibility.enum.ts).
// Every existing Event is backfilled as PRIVATE - the participant list was
// staff-only before this setting existed, so nothing already published
// becomes visible to anyone new without its organizer opting in. Only new
// Events default to PUBLIC.
export class Migration20260930120000_AddEventParticipantsVisibility extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "events" add column "participants_visibility" text not null default 'PRIVATE' check ("participants_visibility" in ('PUBLIC', 'PRIVATE'));`);
    this.addSql(`alter table "events" alter column "participants_visibility" set default 'PUBLIC';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop column "participants_visibility";`);
  }

}
