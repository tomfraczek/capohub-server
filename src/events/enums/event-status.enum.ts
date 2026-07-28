// No physical deletion of Events at all (spec: "Nie implementuj usuwania
// Eventów... Historia ma zostać zachowana") - every transition is recorded
// in EventStatusHistory and is one of these four values.
//
// Allowed transitions (enforced by EventsService, mirroring
// group-write-policy.ts's per-status conflict pattern):
//   DRAFT -> PUBLISHED   (publish)
//   DRAFT -> CANCELLED   (cancel an event that was never published)
//   PUBLISHED -> CANCELLED
//   PUBLISHED -> FINISHED (manually, via the finish action, or lazily
//     reconciled the next time the Event is read/acted on once `endsAt`
//     has passed - this codebase has no scheduler/cron infrastructure, so
//     this mirrors the same lazy-reconciliation pattern already used for
//     MembershipSuspension expiry - see events.service.ts).
// CANCELLED and FINISHED are both terminal - no transition leaves them.
export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  FINISHED = 'FINISHED',
}
