import { Migration } from '@mikro-orm/migrations';

export class Migration20260714183038_AddUser extends Migration {
  override async up(): Promise<void> {
    this.addSql(
      `create table "users" ("id" uuid not null, "created_at" timestamptz not null, "updated_at" timestamptz not null, "clerk_user_id" varchar(255) not null, "email" varchar(255) not null, "first_name" varchar(255) null, "last_name" varchar(255) null, "image_url" varchar(255) null, "is_active" boolean not null default true, "last_login_at" timestamptz null, constraint "users_pkey" primary key ("id"));`,
    );
    this.addSql(
      `alter table "users" add constraint "users_clerk_user_id_unique" unique ("clerk_user_id");`,
    );
    this.addSql(`create index "users_email_index" on "users" ("email");`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "users" cascade;`);
  }
}
