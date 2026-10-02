import { Migration } from '@mikro-orm/migrations';

// Adds Group.followersVisibility and Section.membersVisibility (see
// groups/enums/community-list-visibility.enum.ts).
//  - groups: every existing Group is backfilled as PRIVATE - its followers
//    list was OWNER/ADMIN-only before this setting existed, so nothing
//    becomes visible to anyone new without an admin opting in. New Groups
//    default to PUBLIC (same pattern as events.participants_visibility).
//  - sections: backfilled and defaulted as PUBLIC - every member could
//    already see the members list, so existing Sections keep behaving
//    exactly as before.
export class Migration20261002120000_AddCommunityListVisibility extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "groups" add column "followers_visibility" text not null default 'PRIVATE' check ("followers_visibility" in ('PUBLIC', 'PRIVATE'));`);
    this.addSql(`alter table "groups" alter column "followers_visibility" set default 'PUBLIC';`);
    this.addSql(`alter table "sections" add column "members_visibility" text not null default 'PUBLIC' check ("members_visibility" in ('PUBLIC', 'PRIVATE'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" drop column "followers_visibility";`);
    this.addSql(`alter table "sections" drop column "members_visibility";`);
  }

}
