import { Migration } from '@mikro-orm/migrations';

// Recipient Groups are never physically deleted - `is_active = false` is
// the only "removal" state (see recipient-group.entity.ts). The old
// unique index on (group_id, lower(name)) constrained *every* row,
// active or not, so a name could never be reused once its Recipient
// Group was deactivated - forcing an admin to reactivate/rename the old,
// historical row instead of publishing a fresh one (task requirement:
// "Trenerzy" (ACTIVE) -> deactivate -> create a new "Trenerzy" (ACTIVE)
// must succeed with no validation error).
//
// Replaces it with a partial unique index scoped to `is_active = true` -
// uniqueness now only ever compares currently-active Recipient Groups
// against each other. Inactive rows are entirely unconstrained by this
// index, so any number of deactivated Recipient Groups may share a name,
// including one that also matches a brand new active one. This changes
// only which *new* writes are allowed; it never touches existing rows,
// AnnouncementRecipient snapshots, or Announcement visibility.
export class Migration20260801090000_MakeRecipientGroupNameUniquenessActiveOnly extends Migration {
  override async up(): Promise<void> {
    this.addSql(`drop index "recipient_groups_group_id_name_unique";`);
    this.addSql(
      `create unique index "recipient_groups_group_id_name_active_unique" on "recipient_groups" ("group_id", lower("name")) where ("is_active" = true);`,
    );
  }

  override async down(): Promise<void> {
    this.addSql(
      `drop index "recipient_groups_group_id_name_active_unique";`,
    );
    this.addSql(
      `create unique index "recipient_groups_group_id_name_unique" on "recipient_groups" ("group_id", lower("name"));`,
    );
  }
}
