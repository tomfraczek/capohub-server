import { Migration } from '@mikro-orm/migrations';

// Splits Group "Dołączanie publiczne" off from Group.isPublic (which stays
// the profile-visibility flag) into its own groups.join_requires_approval
// column - see group.entity.ts. Backfilled as `not is_public`: the app's
// only switch for is_public was labelled "Dołączanie publiczne" ("off =
// joining creates a request an administrator approves"), so an owner who
// turned it off asked for exactly this. New Groups default to false.
//
// Also widens notifications_type_check with the three GROUP_JOIN_REQUEST_*
// types (formal-Group join requests - see MembershipRequestsService).
const NOTIFICATION_TYPES_BEFORE = [
  'TRAINING_CANCELLED', 'TRAINING_TIME_CHANGED', 'TRAINING_LOCATION_CHANGED', 'TRAINING_TRAINER_CHANGED',
  'TRAINING_REMINDER_24H', 'TRAINING_REMINDER_2H', 'EVENT_INVITATION', 'EVENT_PUBLISHED', 'EVENT_CANCELLED',
  'EVENT_TIME_CHANGED', 'EVENT_LOCATION_CHANGED', 'EVENT_REMINDER_24H', 'EVENT_REMINDER_2H',
  'ANNOUNCEMENT_PUBLISHED', 'IMPORTANT_ANNOUNCEMENT_PUBLISHED', 'SECTION_JOIN_REQUEST_RECEIVED',
  'SECTION_JOIN_REQUEST_APPROVED', 'SECTION_JOIN_REQUEST_REJECTED', 'SECTION_INVITATION_RECEIVED',
  'SECTION_INVITATION_ACCEPTED', 'SECTION_INVITATION_REJECTED', 'HIERARCHY_INVITATION_RECEIVED',
  'HIERARCHY_INVITATION_ACCEPTED', 'HIERARCHY_INVITATION_REJECTED', 'FORMAL_RANK_CORRECTION_REQUIRED',
  'FORMAL_RANK_CORRECTION_SUBMITTED', 'FORMAL_RANK_CORRECTION_APPROVED', 'FORMAL_RANK_CORRECTION_REJECTED',
];
const NOTIFICATION_TYPES_AFTER = [
  ...NOTIFICATION_TYPES_BEFORE,
  'GROUP_JOIN_REQUEST_RECEIVED', 'GROUP_JOIN_REQUEST_APPROVED', 'GROUP_JOIN_REQUEST_REJECTED',
];

function typeCheck(types: string[]): string {
  return `alter table "notifications" add constraint "notifications_type_check" check("type" in (${types.map((type) => `'${type}'`).join(', ')}));`;
}

export class Migration20261005100000_AddGroupJoinRequiresApproval extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "join_requires_approval" boolean not null default false;`);
    this.addSql(`update "groups" set "join_requires_approval" = not "is_public";`);

    this.addSql(`alter table "notifications" drop constraint if exists "notifications_type_check";`);
    this.addSql(typeCheck(NOTIFICATION_TYPES_AFTER));
  }

  override async down(): Promise<void> {
    this.addSql(`delete from "notifications" where "type" in ('GROUP_JOIN_REQUEST_RECEIVED', 'GROUP_JOIN_REQUEST_APPROVED', 'GROUP_JOIN_REQUEST_REJECTED');`);
    this.addSql(`alter table "notifications" drop constraint if exists "notifications_type_check";`);
    this.addSql(typeCheck(NOTIFICATION_TYPES_BEFORE));

    this.addSql(`alter table "groups" drop column "join_requires_approval";`);
  }

}
