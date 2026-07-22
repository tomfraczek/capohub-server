// What the acceptance of this MembershipRequest creates.
//
// ORGANIZATION: targetGroup must be a Root Group.  Accepting creates or
//   reactivates a GroupMembership for the Root Group (the organization-level
//   participation record), but does NOT create any RoleAssignment anywhere.
//   See ADR-004 (Membership ≠ Role), ADR-028.
//
// GROUP: targetGroup may be a Root or Child Group.  Accepting ensures a
//   GroupMembership in the Root Group AND grants the MEMBER RoleAssignment
//   for the exact targetGroup only.  No MEMBER is created elsewhere, and no
//   Role higher than MEMBER may ever be set via this path.
export enum MembershipRequestTarget {
  ORGANIZATION = 'ORGANIZATION',
  GROUP = 'GROUP',
}
