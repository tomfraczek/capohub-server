import { Migration } from '@mikro-orm/migrations';

// Adds Event.participantsVisibility (see event-participants-visibility.enum.ts).
// Every existing Event is backfilled as PRIVATE - the participant list was
// staff-only before this setting existed, so nothing becomes visible to
// anyone new until an organizer opts in.
export class Migration20260930120000_AddEventParticipantsVisibility extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "events" add column "participants_visibility" text not null default 'PRIVATE' check ("participants_visibility" in ('PUBLIC', 'PRIVATE'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "events" drop column "participants_visibility";`);
  }

}
