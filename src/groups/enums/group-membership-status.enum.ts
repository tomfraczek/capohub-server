// A GroupMembership row is never reused across a user's tenure in a group -
// membership history is preserved (see GroupMembership entity). Only one
// ACTIVE row may exist per (group, user) pair at a time; that invariant is
// enforced by GroupMembershipsService, not by a DB constraint.
export enum GroupMembershipStatus {
  ACTIVE = 'ACTIVE',
  LEFT = 'LEFT',
  REMOVED = 'REMOVED',
}
