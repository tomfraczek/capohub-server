// Full lifecycle of a MembershipRequest row (see
// organization-entities.md#invitation and organization-scenarios.md).
//
// Terminal states (ACCEPTED, REJECTED, CANCELLED) are permanent - a
// terminal row is never reused, reactivated, or re-accepted.  Ponowne
// zaproszenie (re-invite) creates a *new* row.
export enum MembershipRequestStatus {
  // Waiting for a decision.  Only one PENDING request per (targetGroup,
  // recipient) may exist at a time (enforced by partial unique indexes on
  // the entity).
  PENDING = 'PENDING',

  // INVITATION accepted by the invitee, OR JOIN_REQUEST approved by an
  // admin/owner. Membership + MEMBER Role (for GROUP target) were already
  // created inside the same transaction.
  ACCEPTED = 'ACCEPTED',

  // INVITATION rejected by the invitee, OR JOIN_REQUEST rejected by an
  // admin/owner.  No Membership or Role was created.
  REJECTED = 'REJECTED',

  // INVITATION cancelled by the inviter or an admin/owner, OR
  // JOIN_REQUEST withdrawn by the requester.  No Membership or Role was
  // created.
  CANCELLED = 'CANCELLED',
}
