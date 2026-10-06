import { Migration } from '@mikro-orm/migrations';

// MembershipRequest.requestedStartedOn - the formal-Group affiliation start
// date a Group join request carries until approval (see
// membership-request.entity.ts). Nullable, no backfill: every existing row
// is either a Section request/invitation or a Group request sent without a
// date.
export class Migration20261006100000_AddMembershipRequestRequestedStartedOn extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "membership_requests" add column "requested_started_on" date null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "membership_requests" drop column "requested_started_on";`);
  }

}
