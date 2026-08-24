// No physical deletion of Events at all (spec: "Nie implementuj usuwania
// Eventów... Historia ma zostać zachowana") - every transition is recorded
// in EventStatusHistory and is one of these five values.
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
//   FINISHED -> ARCHIVED  (explicit action only - see EventsService.archive)
//   CANCELLED -> ARCHIVED (explicit action only - see EventsService.archive)
// ARCHIVED is the only terminal-of-terminals: FINISHED and CANCELLED can
// still become ARCHIVED, but ARCHIVED itself has no transition out (module:
// "Event lifecycle USER-organized Event + usuwanie konta + archiwizacja
// Eventu" - archiving is deliberately one-directional, same as every other
// lifecycle action in this module). DRAFT/PUBLISHED never go directly to
// ARCHIVED, even automatically when their organizer's account is deleted -
// see EventsService.closeOrganizedEventsForAccountDeletion, which always
// routes through CANCELLED first, reusing the exact same transition an
// organizer could have taken by hand.
export enum EventStatus {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  CANCELLED = 'CANCELLED',
  FINISHED = 'FINISHED',
  ARCHIVED = 'ARCHIVED',
}
