import { Migration } from '@mikro-orm/migrations';

export class Migration20260719164219_AddGroupStatusReadOnly extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table "groups" drop constraint if exists "groups_status_check";`);

    this.addSql(`alter table "groups" add constraint "groups_status_check" check("status" in ('ACTIVE', 'READ_ONLY', 'ARCHIVED'));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "groups" drop constraint if exists "groups_status_check";`);

    this.addSql(`alter table "groups" add constraint "groups_status_check" check("status" in ('ACTIVE', 'ARCHIVED'));`);
  }

}
