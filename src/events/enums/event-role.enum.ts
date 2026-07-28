// Per-Event administrative role, held via EventRoleAssignment - fully
// independent of GroupRole/Community roles (see the Events spec: "Oddziel
// role administracyjne Eventu od ról Community"). A user's authority over
// one Event says nothing about their Community role, and vice versa.
export enum EventRole {
  // Exactly one active OWNER per Event at all times (see
  // EVENT_ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX) - moves only via an atomic
  // ownership transfer, mirroring GroupRole.OWNER/RoleAssignment.
  OWNER = 'OWNER',
  // Full day-to-day management of the Event (edit, publish, cancel, finish,
  // invitations, moderators) - see event-role-permissions.map.ts.
  ORGANIZER = 'ORGANIZER',
  // Operational, day-of-event role: check-in and participant/waitlist
  // management only - see event-role-permissions.map.ts. Neither Organizer
  // nor Moderator is required to also be a participant of the Event (their
  // own EventAttendee row, if any, is entirely independent).
  MODERATOR = 'MODERATOR',
}
