// Group-scoped permissions, checked against a user's active GroupMembership
// role (see group-role-permissions.map.ts) - not against GlobalRole/Permission
// (auth/permissions/permission.enum.ts), which stays a fully separate,
// site-wide system. Endpoints are authorized against these, never against
// GroupRole directly (mirrors the Permission/GlobalRole split).
export enum GroupPermission {
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
  GROUP_MEMBER_ADD = 'GROUP_MEMBER_ADD',
  GROUP_MEMBER_ROLE_CHANGE = 'GROUP_MEMBER_ROLE_CHANGE',
  GROUP_MEMBER_REMOVE = 'GROUP_MEMBER_REMOVE',
}
