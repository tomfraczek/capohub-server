// Recorded alongside GroupMembershipStatus.ARCHIVED - the documented
// status set (INVITED/ACTIVE/READ_ONLY/ARCHIVED, see
// organization-entities.md#membership) has no separate "left" vs
// "removed" status, but the distinction between a self-service leave and
// an administrator removing a member must still be preserved in history
// (organization-entities.md#membership: "which of the two happened is
// recorded separately from status"). `null` while the Membership is not
// (yet) archived.
export enum MembershipEndReason {
  LEFT = 'LEFT',
  REMOVED = 'REMOVED',
}
