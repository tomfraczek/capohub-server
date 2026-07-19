import { Migration } from '@mikro-orm/migrations';

export class Migration20260719113956_AddGroupMembershipActiveUniqueIndex extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create unique index "group_memberships_group_id_user_id_active_unique" on public.group_memberships ("group_id", "user_id") where ("status" = 'ACTIVE');`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop index "group_memberships_group_id_user_id_active_unique";`);
  }

}
