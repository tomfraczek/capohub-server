import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';

// Built hierarchically, same convention as ROLE_PERMISSIONS
// (auth/permissions/role-permissions.map.ts) - each tier spreads the one
// below it and adds only what's new. This map answers "can this Role, in
// this Group, take this kind of action" - nothing more; it never expresses
// target-specific rules (an ADMIN may change another member's Role in
// general, but not the OWNER's; nobody may grant OWNER through the
// role-change endpoint; the OWNER cannot leave without transferring first).
// Those invariants depend on which member is being acted on, not just the
// actor's Role, so they're enforced in GroupMembershipsService/
// RoleAssignmentsService instead.
//
// This is the single, deterministic source of truth for Role -> Permission.
// GroupPermissionsGuard (and anything else checking authorization) must go
// through GroupPermissionService, never compare Role names directly -
// ownership-transfer is the one documented exception, since "is this
// membership currently the OWNER" is an identity check, not a capability
// check.

const MEMBER_PERMISSIONS: readonly GroupPermission[] = [
  GroupPermission.GROUP_VIEW,
  GroupPermission.MEMBERSHIP_VIEW,
  GroupPermission.ACADEMY_VIEW,
  GroupPermission.SECTION_VIEW,
  // GROUP_INVITE is intentionally included here even though service-layer
  // logic additionally gates it on Group.memberInvitesAllowed.  This allows
  // the GroupPermissionsGuard to let MEMBER requests through to the service;
  // the service then rejects them when the setting is off.  ADMIN and OWNER
  // always pass regardless of the setting.
  GroupPermission.GROUP_INVITE,
];

// INSTRUCTOR and ASSISTANT have no extra permissions yet - they carry no
// functional weight until training/attendance modules land in a later
// stage.
const ASSISTANT_PERMISSIONS: readonly GroupPermission[] = [
  ...MEMBER_PERMISSIONS,
];

const INSTRUCTOR_PERMISSIONS: readonly GroupPermission[] = [
  ...MEMBER_PERMISSIONS,
];

const ADMIN_PERMISSIONS: readonly GroupPermission[] = [
  ...MEMBER_PERMISSIONS,
  GroupPermission.GROUP_EDIT,
  GroupPermission.GROUP_SETTINGS_MANAGE,
  GroupPermission.MEMBERSHIP_ADD,
  GroupPermission.MEMBERSHIP_ROLE_CHANGE,
  GroupPermission.MEMBERSHIP_REMOVE,
  GroupPermission.MEMBERSHIP_SECTION_ASSIGN,
  GroupPermission.MEMBERSHIP_INVITE,
  GroupPermission.MEMBERSHIP_REQUEST_REVIEW,
  GroupPermission.GROUP_JOIN_REQUEST_REVIEW,
  GroupPermission.ACADEMY_CREATE,
  GroupPermission.ACADEMY_EDIT,
  GroupPermission.ACADEMY_ARCHIVE,
  GroupPermission.SECTION_CREATE,
  GroupPermission.SECTION_EDIT,
  GroupPermission.SECTION_ARCHIVE,
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

// Subset of GroupPermission that remains available while a Membership is
// READ_ONLY (see organization-entities.md#membership: "remains visible...
// but the user loses operational permissions"). Every other permission
// requires the Membership to be ACTIVE. Kept as an explicit allow-list,
// not a naming-convention check (e.g. "ends with _VIEW"), so adding a new
// permission can never accidentally become READ_ONLY-safe by naming
// coincidence.
export const READ_ONLY_SAFE_PERMISSIONS: ReadonlySet<GroupPermission> = new Set(
  [
    GroupPermission.GROUP_VIEW,
    GroupPermission.MEMBERSHIP_VIEW,
    GroupPermission.ACADEMY_VIEW,
    GroupPermission.SECTION_VIEW,
  ],
);
