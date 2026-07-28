// Contextual capability data for one Event, computed server-side from the
// caller's EventRoleAssignment(s) (and, for canModerate, their Community
// role) - the frontend must never derive any of these from a role list
// itself (spec: "Frontend nie powinien wyliczać uprawnień z ról"). Unlike
// CommunityHomeCapabilitiesDto (which returns id-lists because it spans
// many communities at once), this DTO is already scoped to one specific
// Event, so plain booleans are the right shape here.
export interface EventCapabilitiesDto {
  // Any Event role at all (Owner/Organizer/Moderator) - gates the
  // organizer-only reads (history, roles list, invitations list, admin
  // participants list).
  canViewManagement: boolean;
  canEdit: boolean;
  canPublish: boolean;
  canCancel: boolean;
  canFinish: boolean;
  canManageOrganizers: boolean;
  canManageModerators: boolean;
  canTransferOwnership: boolean;
  canManageInvitations: boolean;
  canManageParticipants: boolean;
  canCheckIn: boolean;
  // Self-registration eligibility given visibility + Community membership
  // + invitation status - independent of holding any Event role.
  canRegister: boolean;
}
