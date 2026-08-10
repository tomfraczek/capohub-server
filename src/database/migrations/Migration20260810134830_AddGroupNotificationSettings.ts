import { Migration } from '@mikro-orm/migrations';

// Widens community_notification_settings from Section-only to Group-or-
// Section (see CommunityNotificationSettings' own comment): splits the
// single required `community_id` FK into two nullable FKs
// (community_group_id/community_section_id, exactly one ever set - same
// shape as announcements/events/notifications), replaces the plain
// (community_id, user_id) unique constraint with a coalesce-based unique
// index (same pattern as role_assignments_user_id_group_id_role_unique)
// so two Group-type rows for the same user can never collide via NULL !=
// NULL, and adds the exactly-one check constraint. Drop-and-recreate, not
// a data-preserving rename+add: the table was confirmed empty (0 rows) in
// the dev database before this migration was written, so there is no
// existing data to carry across the column split.
export class Migration20260810134830_AddGroupNotificationSettings extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "community_notification_settings" drop constraint "community_notification_settings_community_id_foreign";`);

    this.addSql(`drop index "community_notification_settings_community_id_index";`);
    this.addSql(`alter table "community_notification_settings" drop constraint "community_notification_settings_community_id_user_id_unique";`);
    this.addSql(`alter table "community_notification_settings" drop column "community_id";`);

    this.addSql(`alter table "community_notification_settings" add column "community_group_id" uuid null, add column "community_section_id" uuid null;`);
    this.addSql(`alter table "community_notification_settings" add constraint "community_notification_settings_community_group_id_foreign" foreign key ("community_group_id") references "groups" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "community_notification_settings" add constraint "community_notification_settings_community_section_id_foreign" foreign key ("community_section_id") references "sections" ("id") on update cascade on delete cascade;`);
    this.addSql(`create index "community_notification_settings_community_group_id_index" on "community_notification_settings" ("community_group_id");`);
    this.addSql(`create index "community_notification_settings_community_section_id_index" on "community_notification_settings" ("community_section_id");`);
    this.addSql(`create unique index "community_notification_settings_user_id_community_unique" on public.community_notification_settings ("user_id", coalesce("community_group_id", "community_section_id"));`);
    this.addSql(`alter table "community_notification_settings" add constraint community_notification_settings_group_or_section_check check(("community_group_id" is not null and "community_section_id" is null) or ("community_group_id" is null and "community_section_id" is not null));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "community_notification_settings" drop constraint "community_notification_settings_community_group_id_foreign";`);
    this.addSql(`alter table "community_notification_settings" drop constraint "community_notification_settings_community_section_id_foreign";`);

    this.addSql(`drop index "community_notification_settings_community_group_id_index";`);
    this.addSql(`drop index "community_notification_settings_community_section_id_index";`);
    this.addSql(`alter table "community_notification_settings" drop constraint "community_notification_settings_user_id_community_unique";`);
    this.addSql(`alter table "community_notification_settings" drop constraint community_notification_settings_group_or_section_check;`);
    this.addSql(`alter table "community_notification_settings" drop column "community_group_id", drop column "community_section_id";`);

    this.addSql(`alter table "community_notification_settings" add column "community_id" uuid not null;`);
    this.addSql(`alter table "community_notification_settings" add constraint "community_notification_settings_community_id_foreign" foreign key ("community_id") references "sections" ("id") on update cascade on delete cascade;`);
    this.addSql(`create index "community_notification_settings_community_id_index" on "community_notification_settings" ("community_id");`);
    this.addSql(`alter table "community_notification_settings" add constraint "community_notification_settings_community_id_user_id_unique" unique ("community_id", "user_id");`);
  }

}
