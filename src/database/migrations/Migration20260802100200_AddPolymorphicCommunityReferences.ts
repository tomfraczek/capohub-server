import { Migration } from '@mikro-orm/migrations';

// Stage 1 of the organizational-domain rebuild (part 3 of 3, see
// Migration20260802100000_SplitGroupsAndSections and
// Migration20260802100100_DropGroupLocationFields).
//
// Seven tables reference "a Group or a Section" through what used to be a
// single FK column, back when both were the same underlying row (see
// role-assignment.entity.ts, academy.entity.ts, cohort.entity.ts,
// recipient-group.entity.ts, membership-request.entity.ts,
// announcement.entity.ts, event.entity.ts). Now that Group and Section are
// separate tables, each of those columns becomes a pair of nullable FKs
// (one to `groups`, one to `sections`), exactly one of which is ever set -
// enforced by a CHECK constraint - with existing values repointed to
// whichever table that id now actually lives in.
//
// This is also the migration that finally deletes the rows out of `groups`
// that Migration20260802100000 copied into `sections` - it could not
// happen there, since every dependent FK below still pointed at `groups`
// and would have been violated by deleting a still-referenced row. It is
// safe here, now that every dependent FK has just been repointed to
// `sections` for exactly those rows.
export class Migration20260802100200_AddPolymorphicCommunityReferences extends Migration {
  override async up(): Promise<void> {
    // ---- role_assignments ----
    this.addSql(`alter table "role_assignments" add column "section_id" uuid null;`);
    this.addSql(`create index "role_assignments_section_id_index" on "role_assignments" ("section_id");`);
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "role_assignments" alter column "group_id" drop not null;`);
    this.addSql(`
      update "role_assignments" set "section_id" = "group_id", "group_id" = null
      where "group_id" in (select "id" from "sections");
    `);
    this.addSql(`alter table "role_assignments" drop constraint "role_assignments_membership_id_group_id_role_unique";`);
    this.addSql(`
      create unique index "role_assignments_membership_id_group_id_role_unique"
        on "role_assignments" ("membership_id", coalesce("group_id", "section_id"), "role");
    `);
    this.addSql(`drop index "role_assignments_group_id_owner_unique";`);
    this.addSql(`
      create unique index "role_assignments_group_id_owner_unique"
        on "role_assignments" (coalesce("group_id", "section_id")) where ("role" = 'OWNER');
    `);
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_group_or_section_check"
        check ((("group_id" is not null))::int + (("section_id" is not null))::int = 1);
    `);

    // ---- academies ----
    this.addSql(`alter table "academies" add column "section_id" uuid null;`);
    this.addSql(`create index "academies_section_id_index" on "academies" ("section_id");`);
    this.addSql(`
      alter table "academies" add constraint "academies_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "academies" alter column "group_id" drop not null;`);
    this.addSql(`
      update "academies" set "section_id" = "group_id", "group_id" = null
      where "group_id" in (select "id" from "sections");
    `);
    this.addSql(`
      alter table "academies" add constraint "academies_group_or_section_check"
        check ((("group_id" is not null))::int + (("section_id" is not null))::int = 1);
    `);

    // ---- cohorts ----
    this.addSql(`alter table "cohorts" add column "section_id" uuid null;`);
    this.addSql(`create index "cohorts_section_id_index" on "cohorts" ("section_id");`);
    this.addSql(`
      alter table "cohorts" add constraint "cohorts_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "cohorts" alter column "group_id" drop not null;`);
    this.addSql(`
      update "cohorts" set "section_id" = "group_id", "group_id" = null
      where "group_id" in (select "id" from "sections");
    `);
    this.addSql(`
      alter table "cohorts" add constraint "cohorts_group_or_section_check"
        check ((("group_id" is not null))::int + (("section_id" is not null))::int = 1);
    `);

    // ---- recipient_groups ----
    this.addSql(`alter table "recipient_groups" add column "section_id" uuid null;`);
    this.addSql(`create index "recipient_groups_section_id_index" on "recipient_groups" ("section_id");`);
    this.addSql(`
      alter table "recipient_groups" add constraint "recipient_groups_section_id_foreign"
        foreign key ("section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "recipient_groups" alter column "group_id" drop not null;`);
    this.addSql(`
      update "recipient_groups" set "section_id" = "group_id", "group_id" = null
      where "group_id" in (select "id" from "sections");
    `);
    this.addSql(`drop index "recipient_groups_group_id_name_active_unique";`);
    this.addSql(`
      create unique index "recipient_groups_community_name_active_unique"
        on "recipient_groups" (coalesce("group_id", "section_id"), lower("name")) where ("is_active" = true);
    `);
    this.addSql(`
      alter table "recipient_groups" add constraint "recipient_groups_group_or_section_check"
        check ((("group_id" is not null))::int + (("section_id" is not null))::int = 1);
    `);

    // ---- membership_requests ----
    this.addSql(`alter table "membership_requests" add column "target_section_id" uuid null;`);
    this.addSql(`create index "membership_requests_target_section_id_index" on "membership_requests" ("target_section_id");`);
    this.addSql(`
      alter table "membership_requests" add constraint "membership_requests_target_section_id_foreign"
        foreign key ("target_section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "membership_requests" alter column "target_group_id" drop not null;`);
    this.addSql(`
      update "membership_requests" set "target_section_id" = "target_group_id", "target_group_id" = null
      where "target_group_id" in (select "id" from "sections");
    `);
    this.addSql(`drop index "membership_requests_pending_user_invitation_unique";`);
    this.addSql(`
      create unique index "membership_requests_pending_user_invitation_unique"
        on "membership_requests" (coalesce("target_group_id", "target_section_id"), "invited_user_id")
        where ("status" = 'PENDING' and "type" = 'INVITATION' and "invited_user_id" is not null);
    `);
    this.addSql(`drop index "membership_requests_pending_email_invitation_unique";`);
    this.addSql(`
      create unique index "membership_requests_pending_email_invitation_unique"
        on "membership_requests" (coalesce("target_group_id", "target_section_id"), "invited_email")
        where ("status" = 'PENDING' and "type" = 'INVITATION' and "invited_email" is not null);
    `);
    this.addSql(`drop index "membership_requests_pending_join_request_unique";`);
    this.addSql(`
      create unique index "membership_requests_pending_join_request_unique"
        on "membership_requests" (coalesce("target_group_id", "target_section_id"), "initiated_by_id")
        where ("status" = 'PENDING' and "type" = 'JOIN_REQUEST');
    `);
    this.addSql(`
      alter table "membership_requests" add constraint "membership_requests_target_group_or_section_check"
        check ((("target_group_id" is not null))::int + (("target_section_id" is not null))::int = 1);
    `);

    // ---- announcements ----
    this.addSql(`alter table "announcements" drop constraint "announcements_community_id_foreign";`);
    this.addSql(`drop index "announcements_community_id_index";`);
    this.addSql(`alter table "announcements" rename column "community_id" to "community_group_id";`);
    this.addSql(`alter table "announcements" alter column "community_group_id" drop not null;`);
    this.addSql(`create index "announcements_community_group_id_index" on "announcements" ("community_group_id");`);
    this.addSql(`
      alter table "announcements" add constraint "announcements_community_group_id_foreign"
        foreign key ("community_group_id") references "groups" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "announcements" add column "community_section_id" uuid null;`);
    this.addSql(`create index "announcements_community_section_id_index" on "announcements" ("community_section_id");`);
    this.addSql(`
      alter table "announcements" add constraint "announcements_community_section_id_foreign"
        foreign key ("community_section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      update "announcements" set "community_section_id" = "community_group_id", "community_group_id" = null
      where "community_group_id" in (select "id" from "sections");
    `);
    this.addSql(`
      alter table "announcements" add constraint "announcements_community_group_or_section_check"
        check ((("community_group_id" is not null))::int + (("community_section_id" is not null))::int = 1);
    `);

    // ---- events ----
    this.addSql(`alter table "events" drop constraint "events_community_id_foreign";`);
    this.addSql(`drop index "events_community_id_index";`);
    this.addSql(`drop index "events_community_id_status_index";`);
    this.addSql(`alter table "events" rename column "community_id" to "community_group_id";`);
    this.addSql(`alter table "events" alter column "community_group_id" drop not null;`);
    this.addSql(`create index "events_community_group_id_index" on "events" ("community_group_id");`);
    this.addSql(`create index "events_community_group_id_status_index" on "events" ("community_group_id", "status");`);
    this.addSql(`
      alter table "events" add constraint "events_community_group_id_foreign"
        foreign key ("community_group_id") references "groups" ("id") on update cascade on delete no action;
    `);
    this.addSql(`alter table "events" add column "community_section_id" uuid null;`);
    this.addSql(`create index "events_community_section_id_index" on "events" ("community_section_id");`);
    this.addSql(`create index "events_community_section_id_status_index" on "events" ("community_section_id", "status");`);
    this.addSql(`
      alter table "events" add constraint "events_community_section_id_foreign"
        foreign key ("community_section_id") references "sections" ("id") on update cascade on delete no action;
    `);
    this.addSql(`
      update "events" set "community_section_id" = "community_group_id", "community_group_id" = null
      where "community_group_id" in (select "id" from "sections");
    `);
    this.addSql(`
      alter table "events" add constraint "events_community_group_or_section_check"
        check ((("community_group_id" is not null))::int + (("community_section_id" is not null))::int = 1);
    `);

    // ---- finally: remove the moved rows from `groups` now that every
    // dependent FK above has been repointed to `sections` for them ----
    // Every row with parent_group_id IS NOT NULL was moved to `sections` by
    // Migration20260802100000 (whose own guard already refused to run if
    // any such row had children), so no further filtering is needed here.
    this.addSql(`
      delete from "groups" g
      where g."parent_group_id" is not null;
    `);
  }

  override async down(): Promise<void> {
    // Restore the rows this migration's up() deleted from `groups` -
    // copying only the columns `groups` still has at this point in the
    // down sequence (location fields are restored later, by
    // Migration20260802100100's own down(), which runs after this one).
    this.addSql(`
      insert into "groups"
        ("id", "created_at", "updated_at", "parent_group_id", "name", "description",
         "logo_url", "cover_image_url", "contact_email", "contact_phone", "website_url",
         "facebook_url", "instagram_url", "youtube_url", "is_public", "is_hidden",
         "member_invites_allowed", "public_code", "status", "timezone", "currency_code")
      select
        "id", "created_at", "updated_at", "parent_group_id", "name", "description",
        "logo_url", "cover_image_url", "contact_email", "contact_phone", "website_url",
        "facebook_url", "instagram_url", "youtube_url", "is_public", "is_hidden",
        "member_invites_allowed", "public_code", "status", "timezone", "currency_code"
      from "sections";
    `);

    // ---- events ----
    this.addSql(`
      update "events" set "community_group_id" = "community_section_id", "community_section_id" = null
      where "community_section_id" is not null;
    `);
    this.addSql(`alter table "events" drop constraint "events_community_group_or_section_check";`);
    this.addSql(`alter table "events" drop constraint "events_community_section_id_foreign";`);
    this.addSql(`drop index "events_community_section_id_status_index";`);
    this.addSql(`drop index "events_community_section_id_index";`);
    this.addSql(`alter table "events" drop column "community_section_id";`);
    this.addSql(`alter table "events" drop constraint "events_community_group_id_foreign";`);
    this.addSql(`drop index "events_community_group_id_status_index";`);
    this.addSql(`drop index "events_community_group_id_index";`);
    this.addSql(`alter table "events" alter column "community_group_id" set not null;`);
    this.addSql(`alter table "events" rename column "community_group_id" to "community_id";`);
    this.addSql(`create index "events_community_id_index" on "events" ("community_id");`);
    this.addSql(`create index "events_community_id_status_index" on "events" ("community_id", "status");`);
    this.addSql(`
      alter table "events" add constraint "events_community_id_foreign"
        foreign key ("community_id") references "groups" ("id") on update cascade on delete no action;
    `);

    // ---- announcements ----
    this.addSql(`
      update "announcements" set "community_group_id" = "community_section_id", "community_section_id" = null
      where "community_section_id" is not null;
    `);
    this.addSql(`alter table "announcements" drop constraint "announcements_community_group_or_section_check";`);
    this.addSql(`alter table "announcements" drop constraint "announcements_community_section_id_foreign";`);
    this.addSql(`drop index "announcements_community_section_id_index";`);
    this.addSql(`alter table "announcements" drop column "community_section_id";`);
    this.addSql(`alter table "announcements" drop constraint "announcements_community_group_id_foreign";`);
    this.addSql(`drop index "announcements_community_group_id_index";`);
    this.addSql(`alter table "announcements" alter column "community_group_id" set not null;`);
    this.addSql(`alter table "announcements" rename column "community_group_id" to "community_id";`);
    this.addSql(`create index "announcements_community_id_index" on "announcements" ("community_id");`);
    this.addSql(`
      alter table "announcements" add constraint "announcements_community_id_foreign"
        foreign key ("community_id") references "groups" ("id") on update cascade on delete no action;
    `);

    // ---- membership_requests ----
    this.addSql(`
      update "membership_requests" set "target_group_id" = "target_section_id", "target_section_id" = null
      where "target_section_id" is not null;
    `);
    this.addSql(`alter table "membership_requests" drop constraint "membership_requests_target_group_or_section_check";`);
    this.addSql(`drop index "membership_requests_pending_join_request_unique";`);
    this.addSql(`
      create unique index "membership_requests_pending_join_request_unique"
        on "membership_requests" ("target_group_id", "initiated_by_id")
        where ("status" = 'PENDING' and "type" = 'JOIN_REQUEST');
    `);
    this.addSql(`drop index "membership_requests_pending_email_invitation_unique";`);
    this.addSql(`
      create unique index "membership_requests_pending_email_invitation_unique"
        on "membership_requests" ("target_group_id", "invited_email")
        where ("status" = 'PENDING' and "type" = 'INVITATION' and "invited_email" is not null);
    `);
    this.addSql(`drop index "membership_requests_pending_user_invitation_unique";`);
    this.addSql(`
      create unique index "membership_requests_pending_user_invitation_unique"
        on "membership_requests" ("target_group_id", "invited_user_id")
        where ("status" = 'PENDING' and "type" = 'INVITATION' and "invited_user_id" is not null);
    `);
    this.addSql(`alter table "membership_requests" alter column "target_group_id" set not null;`);
    this.addSql(`alter table "membership_requests" drop constraint "membership_requests_target_section_id_foreign";`);
    this.addSql(`drop index "membership_requests_target_section_id_index";`);
    this.addSql(`alter table "membership_requests" drop column "target_section_id";`);

    // ---- recipient_groups ----
    this.addSql(`
      update "recipient_groups" set "group_id" = "section_id", "section_id" = null
      where "section_id" is not null;
    `);
    this.addSql(`alter table "recipient_groups" drop constraint "recipient_groups_group_or_section_check";`);
    this.addSql(`drop index "recipient_groups_community_name_active_unique";`);
    this.addSql(`
      create unique index "recipient_groups_group_id_name_active_unique"
        on "recipient_groups" ("group_id", lower("name")) where ("is_active" = true);
    `);
    this.addSql(`alter table "recipient_groups" alter column "group_id" set not null;`);
    this.addSql(`alter table "recipient_groups" drop constraint "recipient_groups_section_id_foreign";`);
    this.addSql(`drop index "recipient_groups_section_id_index";`);
    this.addSql(`alter table "recipient_groups" drop column "section_id";`);

    // ---- cohorts ----
    this.addSql(`
      update "cohorts" set "group_id" = "section_id", "section_id" = null where "section_id" is not null;
    `);
    this.addSql(`alter table "cohorts" drop constraint "cohorts_group_or_section_check";`);
    this.addSql(`alter table "cohorts" alter column "group_id" set not null;`);
    this.addSql(`alter table "cohorts" drop constraint "cohorts_section_id_foreign";`);
    this.addSql(`drop index "cohorts_section_id_index";`);
    this.addSql(`alter table "cohorts" drop column "section_id";`);

    // ---- academies ----
    this.addSql(`
      update "academies" set "group_id" = "section_id", "section_id" = null where "section_id" is not null;
    `);
    this.addSql(`alter table "academies" drop constraint "academies_group_or_section_check";`);
    this.addSql(`alter table "academies" alter column "group_id" set not null;`);
    this.addSql(`alter table "academies" drop constraint "academies_section_id_foreign";`);
    this.addSql(`drop index "academies_section_id_index";`);
    this.addSql(`alter table "academies" drop column "section_id";`);

    // ---- role_assignments ----
    this.addSql(`
      update "role_assignments" set "group_id" = "section_id", "section_id" = null where "section_id" is not null;
    `);
    this.addSql(`alter table "role_assignments" drop constraint "role_assignments_group_or_section_check";`);
    this.addSql(`drop index "role_assignments_group_id_owner_unique";`);
    this.addSql(`
      create unique index "role_assignments_group_id_owner_unique"
        on "role_assignments" ("group_id") where ("role" = 'OWNER');
    `);
    this.addSql(`drop index "role_assignments_membership_id_group_id_role_unique";`);
    this.addSql(`
      alter table "role_assignments" add constraint "role_assignments_membership_id_group_id_role_unique"
        unique ("membership_id", "group_id", "role");
    `);
    this.addSql(`alter table "role_assignments" alter column "group_id" set not null;`);
    this.addSql(`alter table "role_assignments" drop constraint "role_assignments_section_id_foreign";`);
    this.addSql(`drop index "role_assignments_section_id_index";`);
    this.addSql(`alter table "role_assignments" drop column "section_id";`);
  }
}
