// See event-invitation.entity.ts for the full lifecycle. PENDING is the
// only non-terminal value; ACCEPTED is set implicitly by
// EventRsvpService.register (there is no separate "accept" endpoint -
// registering IS accepting). DECLINED and CANCELLED are both terminal but
// distinguish who ended it: DECLINED = the invitee said no,
// CANCELLED = the inviter/an Organizer withdrew the invitation.
export enum EventInvitationStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DECLINED = 'DECLINED',
  CANCELLED = 'CANCELLED',
}
