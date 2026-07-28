// Governs both who can *see* an Event and who can *self-register* for it -
// see events-api.md "Visibility" for the full read/registration matrix.
export enum EventVisibility {
  // Any authenticated app user can view and self-register, regardless of
  // Community membership.
  PUBLIC = 'PUBLIC',
  // Only active members of the Event's own Community can view/self-register.
  COMMUNITY_MEMBERS = 'COMMUNITY_MEMBERS',
  // Only people holding a non-cancelled EventInvitation (or an Event role)
  // can view/register - see event-invitation.entity.ts.
  INVITE_ONLY = 'INVITE_ONLY',
}
