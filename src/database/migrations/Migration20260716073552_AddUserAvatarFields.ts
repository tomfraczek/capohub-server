import { Migration } from '@mikro-orm/migrations';

export class Migration20260716073552_AddUserAvatarFields extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "avatar_type" text check ("avatar_type" in ('CLERK', 'UPLOAD', 'PRESET')) not null default 'CLERK', add column "preset_avatar_id" varchar(100) null;`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "avatar_type", drop column "preset_avatar_id";`);
  }

}
