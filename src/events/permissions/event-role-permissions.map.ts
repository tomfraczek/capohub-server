import { EventRole } from '../enums/event-role.enum';
import { EventPermission } from './event-permission.enum';

// Built hierarchically, same convention as GROUP_ROLE_PERMISSIONS - each
// tier spreads the one below it and adds only what's new. This map answers
// "can this Role, for this Event, take this kind of action" - nothing
// more; target-specific rules (only OWNER may grant ORGANIZER; OWNER
// itself is never grantable/revocable through the roles endpoint, only
// through transferOwnership) are enforced in EventRolesService, not here -
// same split as GroupPermissionService/RoleAssignmentsService.

const MODERATOR_PERMISSIONS: readonly EventPermission[] = [
  EventPermission.EVENT_VIEW_MANAGEMENT,
  EventPermission.EVENT_MANAGE_PARTICIPANTS,
  EventPermission.EVENT_CHECKIN,
];

const ORGANIZER_PERMISSIONS: readonly EventPermission[] = [
  ...MODERATOR_PERMISSIONS,
  EventPermission.EVENT_EDIT,
  EventPermission.EVENT_PUBLISH,
  EventPermission.EVENT_CANCEL,
  EventPermission.EVENT_FINISH,
  EventPermission.EVENT_MANAGE_MODERATORS,
  EventPermission.EVENT_MANAGE_INVITATIONS,
];

// EVENT_MANAGE_ORGANIZERS and EVENT_OWNERSHIP_TRANSFER are deliberately
// withheld from ORGANIZER and reserved for OWNER, mirroring how
// GROUP_OWNERSHIP_TRANSFER is OWNER-only in group-role-permissions.map.ts:
// an ORGANIZER may run the event day-to-day but may not mint peers or move
// ownership.
const OWNER_PERMISSIONS: readonly EventPermission[] = [
  ...ORGANIZER_PERMISSIONS,
  EventPermission.EVENT_MANAGE_ORGANIZERS,
  EventPermission.EVENT_OWNERSHIP_TRANSFER,
];

export const EVENT_ROLE_PERMISSIONS: Readonly<
  Record<EventRole, readonly EventPermission[]>
> = {
  [EventRole.MODERATOR]: MODERATOR_PERMISSIONS,
  [EventRole.ORGANIZER]: ORGANIZER_PERMISSIONS,
  [EventRole.OWNER]: OWNER_PERMISSIONS,
};
