// Full lifecycle of a HierarchyInvitation row (see hierarchy-invitation.entity.ts).
//
// Terminal states (ACCEPTED, REJECTED, CANCELLED) are permanent - a
// terminal row is never reused or re-processed. Sending a fresh invitation
// for the same relation always creates a new row. Deliberately no EXPIRED
// state - there is no expiry mechanism (scheduler/TTL) for this stage, and
// adding the status without the mechanism behind it would be misleading.
export enum HierarchyInvitationStatus {
  // Waiting for the target's OWNER to accept or reject. At most one PENDING
  // invitation may exist per (parentGroup, target) pair (enforced by a
  // partial unique index on the entity).
  PENDING = 'PENDING',

  // Accepted by the target's OWNER - the attach was performed atomically in
  // the same transaction as this status change.
  ACCEPTED = 'ACCEPTED',

  // Rejected by the target's OWNER. No hierarchy relationship was created.
  REJECTED = 'REJECTED',

  // Cancelled by the inviting parent (an actor holding HIERARCHY_INVITE
  // there). No hierarchy relationship was created.
  CANCELLED = 'CANCELLED',
}
