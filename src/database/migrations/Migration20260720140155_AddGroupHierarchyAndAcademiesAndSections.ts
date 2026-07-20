import { Migration } from '@mikro-orm/migrations';

export class Migration20260720140155_AddGroupHierarchyAndAcademiesAndSections extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "academies" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "group_id" uuid not null, "name" varchar(150) not null, "address" text null, "latitude" real null, "longitude" real null, "contact_email" varchar(255) null, "contact_phone" varchar(50) null, "opening_hours" text null, "photo_urls" jsonb null, "description" text null, "status" text check ("status" in ('ACTIVE', 'ARCHIVED')) not null default 'ACTIVE', constraint "academies_pkey" primary key ("id"));`);
    this.addSql(`create index "academies_group_id_index" on "academies" ("group_id");`);
    this.addSql(`create index "academies_status_index" on "academies" ("status");`);

    this.addSql(`create table "sections" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "group_id" uuid not null, "name" varchar(150) not null, "description" text null, "status" text check ("status" in ('ACTIVE', 'ARCHIVED')) not null default 'ACTIVE', constraint "sections_pkey" primary key ("id"));`);
    this.addSql(`create index "sections_group_id_index" on "sections" ("group_id");`);
    this.addSql(`create index "sections_status_index" on "sections" ("status");`);

    this.addSql(`alter table "academies" add constraint "academies_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade;`);

    this.addSql(`alter table "sections" add constraint "sections_group_id_foreign" foreign key ("group_id") references "groups" ("id") on update cascade;`);

    this.addSql(`alter table "groups" add column "parent_group_id" uuid null;`);
    this.addSql(`alter table "groups" add constraint "groups_parent_group_id_foreign" foreign key ("parent_group_id") references "groups" ("id") on update cascade on delete no action;`);
    this.addSql(`create index "groups_parent_group_id_index" on "groups" ("parent_group_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "academies" cascade;`);

    this.addSql(`drop table if exists "sections" cascade;`);

    this.addSql(`alter table "groups" drop constraint "groups_parent_group_id_foreign";`);

    this.addSql(`drop index "groups_parent_group_id_index";`);
    this.addSql(`alter table "groups" drop column "parent_group_id";`);
  }

}
