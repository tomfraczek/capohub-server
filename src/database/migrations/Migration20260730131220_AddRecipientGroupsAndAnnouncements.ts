import { Migration } from '@mikro-orm/migrations';

// Adds the Recipient Groups + Announcements feature: a manually-managed
// audience list (RecipientGroup/RecipientGroupMember, scoped to exactly
// one Group or Section - see recipient-group.entity.ts) used to target
// Announcements (Announcement/AnnouncementRecipient/AnnouncementRead - see
// announcement.entity.ts).
//
// No status/lifecycle enum type for Announcement itself - "active" is
// always computed from `expires_at` at read time (see
// AnnouncementsService), so there is no column for it to migrate.
export class Migration20260730131220_AddRecipientGroupsAndAnnouncements extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "recipient_groups" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "group_id" uuid not null, "name" varchar(150) not null, "is_active" boolean not null default true, "created_by_id" uuid null, constraint "recipient_groups_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "recipient_groups_group_id_index" on "recipient_groups" ("group_id");`,
    );
    // Case-insensitive per-Group uniqueness (see recipient-group.entity.ts)
    // - needs the expression-index form; a plain unique constraint can only
    // compare raw column values.
    this.addSql(
      `create unique index "recipient_groups_group_id_name_unique" on "recipient_groups" ("group_id", lower("name"));`,
    );

    this.addSql(
      `create table "recipient_group_members" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "recipient_group_id" uuid not null, "user_id" uuid not null, constraint "recipient_group_members_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "recipient_group_members_recipient_group_id_index" on "recipient_group_members" ("recipient_group_id");`,
    );
    this.addSql(
      `create index "recipient_group_members_user_id_index" on "recipient_group_members" ("user_id");`,
    );
    this.addSql(
      `alter table "recipient_group_members" add constraint "recipient_group_members_recipient_group_id_user_id_unique" unique ("recipient_group_id", "user_id");`,
    );

    this.addSql(
      `create table "announcements" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "community_id" uuid not null, "author_id" uuid null, "title" varchar(200) not null, "body" text not null, "recipient_type" text check ("recipient_type" in ('GROUP', 'SECTION', 'RECIPIENT_GROUP')) not null, "recipient_group_id" uuid null, "is_pinned" boolean not null default false, "expires_at" timestamptz not null, constraint "announcements_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "announcements_community_id_index" on "announcements" ("community_id");`,
    );
    this.addSql(
      `create index "announcements_recipient_type_index" on "announcements" ("recipient_type");`,
    );
    this.addSql(
      `create index "announcements_recipient_group_id_index" on "announcements" ("recipient_group_id");`,
    );
    this.addSql(
      `create index "announcements_is_pinned_index" on "announcements" ("is_pinned");`,
    );
    this.addSql(
      `create index "announcements_expires_at_index" on "announcements" ("expires_at");`,
    );
    // Backs the active-list sort (isPinned desc, createdAt desc - see
    // AnnouncementsService) and the archive filter (expires_at <= now())
    // together with the single-column expires_at index above.
    this.addSql(
      `create index "announcements_is_pinned_created_at_index" on "announcements" ("is_pinned", "created_at");`,
    );

    this.addSql(
      `create table "announcement_recipients" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "announcement_id" uuid not null, "user_id" uuid not null, constraint "announcement_recipients_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "announcement_recipients_announcement_id_index" on "announcement_recipients" ("announcement_id");`,
    );
    this.addSql(
      `create index "announcement_recipients_user_id_index" on "announcement_recipients" ("user_id");`,
    );
    this.addSql(
      `alter table "announcement_recipients" add constraint "announcement_recipients_announcement_id_user_id_unique" unique ("announcement_id", "user_id");`,
    );

    this.addSql(
      `create table "announcement_reads" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "announcement_id" uuid not null, "user_id" uuid not null, constraint "announcement_reads_pkey" primary key ("id"));`,
    );
    this.addSql(
      `create index "announcement_reads_announcement_id_index" on "announcement_reads" ("announcement_id");`,
    );
    this.addSql(
      `create index "announcement_reads_user_id_index" on "announcement_reads" ("user_id");`,
    );
    this.addSql(
      `alter table "announcement_reads" add constraint "announcement_reads_announcement_id_user_id_unique" unique ("announcement_id", "user_id");`,
    );

    this.addSql(
      `alter table "recipient_groups" add constraint "recipient_groups_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "recipient_groups" add constraint "recipient_groups_created_by_id_foreign" foreign key ("created_by_id") references "users" ("id") on update cascade on delete set null;`,
    );

    this.addSql(
      `alter table "recipient_group_members" add constraint "recipient_group_members_recipient_group_id_foreign" foreign key ("recipient_group_id") references "recipient_groups" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "recipient_group_members" add constraint "recipient_group_members_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "announcements" add constraint "announcements_community_id_foreign" foreign key ("community_id") references "groups" ("id") on update cascade;`,
    );
    this.addSql(
      `alter table "announcements" add constraint "announcements_author_id_foreign" foreign key ("author_id") references "users" ("id") on update cascade on delete set null;`,
    );
    this.addSql(
      `alter table "announcements" add constraint "announcements_recipient_group_id_foreign" foreign key ("recipient_group_id") references "recipient_groups" ("id") on update cascade on delete set null;`,
    );

    this.addSql(
      `alter table "announcement_recipients" add constraint "announcement_recipients_announcement_id_foreign" foreign key ("announcement_id") references "announcements" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "announcement_recipients" add constraint "announcement_recipients_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );

    this.addSql(
      `alter table "announcement_reads" add constraint "announcement_reads_announcement_id_foreign" foreign key ("announcement_id") references "announcements" ("id") on update cascade on delete cascade;`,
    );
    this.addSql(
      `alter table "announcement_reads" add constraint "announcement_reads_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "recipient_group_members" cascade;`);
    this.addSql(`drop table if exists "recipient_groups" cascade;`);
    this.addSql(`drop table if exists "announcement_recipients" cascade;`);
    this.addSql(`drop table if exists "announcement_reads" cascade;`);
    this.addSql(`drop table if exists "announcements" cascade;`);
  }
}
