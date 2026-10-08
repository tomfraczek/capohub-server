import { Migration } from '@mikro-orm/migrations';

// The hierarchy is now a flat `Group -> Section` tree (see
// GroupHierarchyService): a Group can never become a child, and a
// HierarchyInvitation can only attach a *standalone* Section. Any
// invitation still PENDING that can no longer be accepted under those
// rules is moved to CANCELLED (statuses kept, rows never deleted - same as
// HierarchyManagementService.cancelOtherPendingSectionInvitations does
// from now on):
//  - every PENDING invitation addressed to a Group,
//  - every PENDING invitation addressed to a Section that already belongs
//    to a Group.
// `responded_by_id` stays null - no user acted on these. Legacy
// Group -> Group `parent_group_id` values are deliberately left alone (they
// stay readable and detachable); no data is lost.
//
// Data-only and not reversible: there is no way to tell which CANCELLED
// rows this migration produced, so down() is a no-op.
export class Migration20261007100000_CancelStaleHierarchyInvitations extends Migration {

  override async up(): Promise<void> {
    this.addSql(`update "hierarchy_invitations" set "status" = 'CANCELLED', "responded_at" = now(), "updated_at" = now() where "status" = 'PENDING' and "target_group_id" is not null;`);
    this.addSql(`update "hierarchy_invitations" as "hi" set "status" = 'CANCELLED', "responded_at" = now(), "updated_at" = now() from "sections" as "s" where "hi"."status" = 'PENDING' and "hi"."target_section_id" = "s"."id" and "s"."parent_group_id" is not null;`);
  }

  override async down(): Promise<void> {
    // Intentionally empty - see the class comment.
  }

}
