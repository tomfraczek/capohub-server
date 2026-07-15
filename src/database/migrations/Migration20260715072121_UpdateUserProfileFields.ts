import { Migration } from '@mikro-orm/migrations';

export class Migration20260715072121_UpdateUserProfileFields extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" drop column "first_name", drop column "last_name", drop column "image_url";`);

    this.addSql(`alter table "users" add column "display_name" varchar(100) not null, add column "avatar_url" varchar(255) null, add column "theme" text check ("theme" in ('system', 'light', 'dark')) not null default 'system', add column "notifications_enabled" boolean not null default true;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "display_name", drop column "theme", drop column "notifications_enabled";`);

    this.addSql(`alter table "users" add column "last_name" varchar(255) null, add column "image_url" varchar(255) null;`);
    this.addSql(`alter table "users" rename column "avatar_url" to "first_name";`);
  }

}
