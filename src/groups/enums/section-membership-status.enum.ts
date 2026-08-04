// Invited -> Active <-> ReadOnly -> Archived. A SectionMembership row is
// never reused across a user's tenure in a Section - membership history is
// preserved (see SectionMembership entity). Only one ACTIVE row may exist
// per (section, user) pair at a time; enforced both by
// SectionMembershipsService and by a partial unique DB index (see
// SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX).
//
// ACTIVE grants the full set of permissions a held Role implies. READ_ONLY
// keeps every RoleAssignment intact but restricts effective permissions to
// the READ_ONLY_SAFE_PERMISSIONS subset (see GroupPermissionService) - it
// is never "zero authority", nor full authority. ARCHIVED means the stint
// has ended (leave/remove/ban) - every RoleAssignment tied to that stint
// is revoked (see RoleAssignment.revokedAt) at the same time.
//
// INVITED is unreachable for now - there is no invitation flow yet, only
// the "technical add", which creates memberships directly as ACTIVE.
export enum SectionMembershipStatus {
  INVITED = 'INVITED',
  ACTIVE = 'ACTIVE',
  READ_ONLY = 'READ_ONLY',
  ARCHIVED = 'ARCHIVED',
}
