import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';

// Built hierarchically, same convention as ROLE_PERMISSIONS
// (auth/permissions/role-permissions.map.ts) - each tier spreads the one
// below it and adds only what's new.
//
// This map only decides "can this role, in general, take this kind of
// action" - it deliberately cannot express target-specific rules (an ADMIN
// may change roles in general, but not the OWNER's; nobody may grant OWNER
// through the role-change endpoint; the OWNER cannot leave without
// transferring first). Those invariants depend on which member is being
// acted on, not just the actor's role, so they're enforced in
// GroupMembershipsService instead - see its enforceRoleChangeIsAllowed and
// assertCanLeave.

const MEMBER_PERMISSIONS: readonly GroupPermission[] = [
  GroupPermission.GROUP_VIEW,
];

// INSTRUCTOR and ASSISTANT have no extra permissions yet - they carry no
// functional weight until sections/training modules land in a later stage.
const ASSISTANT_PERMISSIONS: readonly GroupPermission[] = [
  ...MEMBER_PERMISSIONS,
];

const INSTRUCTOR_PERMISSIONS: readonly GroupPermission[] = [
  ...MEMBER_PERMISSIONS,
];

const ADMIN_PERMISSIONS: readonly GroupPermission[] = [
  ...MEMBER_PERMISSIONS,
  GroupPermission.GROUP_EDIT,
  GroupPermission.GROUP_MEMBER_ADD,
  GroupPermission.GROUP_MEMBER_ROLE_CHANGE,
  GroupPermission.GROUP_MEMBER_REMOVE,
];

// Every lifecycle-status permission (ARCHIVE, UNARCHIVE, SET_READ_ONLY,
// ACTIVATE) plus OWNERSHIP_TRANSFER is deliberately withheld from ADMIN and
// reserved for OWNER (spec: admin cannot change the group's lifecycle status
// or transfer/grant ownership, cannot remove/replace the owner).
const OWNER_PERMISSIONS: readonly GroupPermission[] = [
  ...ADMIN_PERMISSIONS,
  GroupPermission.GROUP_ARCHIVE,
  GroupPermission.GROUP_UNARCHIVE,
  GroupPermission.GROUP_SET_READ_ONLY,
  GroupPermission.GROUP_ACTIVATE,
  GroupPermission.GROUP_OWNERSHIP_TRANSFER,
];

export const GROUP_ROLE_PERMISSIONS: Readonly<
  Record<GroupRole, readonly GroupPermission[]>
> = {
  [GroupRole.MEMBER]: MEMBER_PERMISSIONS,
  [GroupRole.ASSISTANT]: ASSISTANT_PERMISSIONS,
  [GroupRole.INSTRUCTOR]: INSTRUCTOR_PERMISSIONS,
  [GroupRole.ADMIN]: ADMIN_PERMISSIONS,
  [GroupRole.OWNER]: OWNER_PERMISSIONS,
};
