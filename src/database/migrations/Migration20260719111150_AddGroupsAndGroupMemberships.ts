import { Migration } from '@mikro-orm/migrations';

export class Migration20260719111150_AddGroupsAndGroupMemberships extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "groups" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "name" varchar(150) not null, "description" text null, "logo_url" varchar(2048) null, "cover_image_url" varchar(2048) null, "contact_email" varchar(255) null, "contact_phone" varchar(50) null, "website_url" varchar(2048) null, "facebook_url" varchar(2048) null, "instagram_url" varchar(2048) null, "youtube_url" varchar(2048) null, "visibility" text check ("visibility" in ('PUBLIC', 'PRIVATE')) not null default 'PUBLIC', "status" text check ("status" in ('ACTIVE', 'ARCHIVED')) not null default 'ACTIVE', "timezone" varchar(100) not null, "currency_code" varchar(3) not null, constraint "groups_pkey" primary key ("id"));`);
    this.addSql(`create index "groups_status_index" on "groups" ("status");`);

    this.addSql(`create table "group_memberships" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "group_id" uuid not null, "user_id" uuid not null, "role" text check ("role" in ('OWNER', 'ADMIN', 'INSTRUCTOR', 'ASSISTANT', 'MEMBER')) not null, "status" text check ("status" in ('ACTIVE', 'LEFT', 'REMOVED')) not null default 'ACTIVE', "joined_at" timestamptz not null, "left_at" timestamptz null, constraint "group_memberships_pkey" primary key ("id"));`);
    this.addSql(`create index "group_memberships_group_id_index" on "group_memberships" ("group_id");`);
    this.addSql(`create index "group_memberships_user_id_index" on "group_memberships" ("user_id");`);
    this.addSql(`create index "group_memberships_group_id_user_id_status_index" on "group_memberships" ("group_id", "user_id", "status");`);

    this.addSql(`alter table "group_memberships" add constraint "group_memberships_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "group_memberships" add constraint "group_memberships_user_id_foreign" foreign key ("user_id") references "users" ("id") on update cascade on delete cascade;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "group_memberships" drop constraint "group_memberships_group_id_foreign";`);

    this.addSql(`drop table if exists "groups" cascade;`);

    this.addSql(`drop table if exists "group_memberships" cascade;`);
  }

}
