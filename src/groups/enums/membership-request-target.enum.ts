// What the acceptance of this MembershipRequest creates (see the
// Group/Section rename ADR - formerly ORGANIZATION/GROUP).
//
// GROUP: targetGroup must be a root Group.  Accepting creates or
//   reactivates a GroupMembership for the Group (the organization-level
//   participation record), but does NOT create any RoleAssignment anywhere.
//   See ADR-004 (Membership ≠ Role), ADR-028.
//
// SECTION: targetGroup may be a Group or a Section, at any depth.
//   Accepting ensures a GroupMembership in the Group AND grants the MEMBER
//   RoleAssignment for the exact targetGroup only.  No MEMBER is created
//   elsewhere, and no Role higher than MEMBER may ever be set via this path.
export enum MembershipRequestTarget {
  GROUP = 'GROUP',
  SECTION = 'SECTION',
}
