import { Migration } from '@mikro-orm/migrations';

export class Migration20260715082038_AddUserGlobalRole extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "users" add column "global_role" text check ("global_role" in ('USER', 'EDITOR', 'MODERATOR', 'ADMIN', 'SUPER_ADMIN')) not null default 'USER';`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "users" drop column "global_role";`);
  }

}
