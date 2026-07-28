// Per-Event capability permissions, checked against a user's
// EventRoleAssignment(s) for the exact Event being acted on (see
// event-role-permissions.map.ts and EventPermissionsGuard) - entirely
// separate from GroupPermission (see the Events spec: "Oddziel role
// administracyjne Eventu od ról Community"). Viewing a specific Event's
// detail is deliberately NOT one of these - that is governed by the
// Event's own `visibility` field, resolved in EventsService, not by a
// Role-based permission (an Organizer/Moderator can always view
// regardless of visibility, which EventsService checks by looking for any
// EventRoleAssignment directly, without going through this enum).
export enum EventPermission {
  // Read access to this Event's organizer-only management data: status
  // history, the full Owner/Organizer/Moderator list, the invitation list,
  // and the admin participant list (with RSVP/waitlist/check-in detail).
  // Granted to every Event role, including MODERATOR.
  EVENT_VIEW_MANAGEMENT = 'EVENT_VIEW_MANAGEMENT',
  EVENT_EDIT = 'EVENT_EDIT',
  EVENT_PUBLISH = 'EVENT_PUBLISH',
  EVENT_CANCEL = 'EVENT_CANCEL',
  EVENT_FINISH = 'EVENT_FINISH',
  // Grant/revoke MODERATOR - held by ORGANIZER and OWNER.
  EVENT_MANAGE_MODERATORS = 'EVENT_MANAGE_MODERATORS',
  // Grant/revoke ORGANIZER - OWNER only (an ORGANIZER cannot mint peers).
  EVENT_MANAGE_ORGANIZERS = 'EVENT_MANAGE_ORGANIZERS',
  // OWNER only - see EventRolesService.transferOwnership.
  EVENT_OWNERSHIP_TRANSFER = 'EVENT_OWNERSHIP_TRANSFER',
  EVENT_MANAGE_INVITATIONS = 'EVENT_MANAGE_INVITATIONS',
  // Manual waitlist promotion/demotion for MANUAL waitlistPolicy events.
  EVENT_MANAGE_PARTICIPANTS = 'EVENT_MANAGE_PARTICIPANTS',
  EVENT_CHECKIN = 'EVENT_CHECKIN',
}
