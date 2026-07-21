// Group-scoped capability permissions, checked against a user's Role
// Assignment for the exact Group being acted on (see
// group-role-permissions.map.ts and GroupPermissionsGuard) - not against
// GlobalRole/Permission (auth/permissions/permission.enum.ts), which stays a
// fully separate, site-wide system. Endpoints are authorized against these,
// never against GroupRole directly (mirrors the Permission/GlobalRole
// split).
//
// Deliberately one enum per existing domain only (Group, Membership,
// Academy, Section) - no permissions for domains that don't exist yet
// (Graduation, Invitations, Visibility Scope, ...). Role Assignment
// management itself has no dedicated permission - it is authorized against
// GROUP_EDIT/GROUP_VIEW for the Group the Role Assignment targets, the same
// as any other administrative action on that Group.
export enum GroupPermission {
  // Group
  GROUP_VIEW = 'GROUP_VIEW',
  GROUP_EDIT = 'GROUP_EDIT',
  GROUP_ARCHIVE = 'GROUP_ARCHIVE',
  // Deliberately separate from GROUP_ARCHIVE, not reused for both
  // directions - archiving and restoring are distinct capabilities that
  // happen to both be OWNER-only today (see group-role-permissions.map.ts).
  GROUP_UNARCHIVE = 'GROUP_UNARCHIVE',
  // Same split as ARCHIVE/UNARCHIVE, one step down the lifecycle: setting
  // READ_ONLY and reactivating from it are separate capabilities.
  GROUP_SET_READ_ONLY = 'GROUP_SET_READ_ONLY',
  GROUP_ACTIVATE = 'GROUP_ACTIVATE',
  GROUP_OWNERSHIP_TRANSFER = 'GROUP_OWNERSHIP_TRANSFER',

  // Membership (always Root Group-scoped - see organization-entities.md#membership)
  MEMBERSHIP_VIEW = 'MEMBERSHIP_VIEW',
  MEMBERSHIP_ADD = 'MEMBERSHIP_ADD',
  MEMBERSHIP_ROLE_CHANGE = 'MEMBERSHIP_ROLE_CHANGE',
  MEMBERSHIP_REMOVE = 'MEMBERSHIP_REMOVE',
  MEMBERSHIP_SECTION_ASSIGN = 'MEMBERSHIP_SECTION_ASSIGN',

  // Academy
  ACADEMY_VIEW = 'ACADEMY_VIEW',
  ACADEMY_CREATE = 'ACADEMY_CREATE',
  ACADEMY_EDIT = 'ACADEMY_EDIT',
  ACADEMY_ARCHIVE = 'ACADEMY_ARCHIVE',

  // Section
  SECTION_VIEW = 'SECTION_VIEW',
  SECTION_CREATE = 'SECTION_CREATE',
  SECTION_EDIT = 'SECTION_EDIT',
  SECTION_ARCHIVE = 'SECTION_ARCHIVE',
}
