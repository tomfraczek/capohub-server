// Matches the documented Membership lifecycle exactly (see
// organization-entities.md#membership and membership-lifecycle.mmd):
// Invited -> Active <-> ReadOnly -> Archived. A GroupMembership row is
// never reused across a user's tenure in a Root Group - membership
// history is preserved (see GroupMembership entity). Only one ACTIVE row
// may exist per (rootGroup, user) pair at a time; enforced both by
// GroupMembershipsService and by a partial unique DB index (see
// GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX).
//
// INVITED is unreachable for now - there is no invitation flow yet (see
// organization-entities.md#invitation), only the "technical add" this
// module already implements, which creates memberships directly as
// ACTIVE. The status is still part of the enum because it's part of the
// documented lifecycle, not something this module invents.
export enum GroupMembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  READ_ONLY = 'READ_ONLY',
  ARCHIVED = 'ARCHIVED',
}
