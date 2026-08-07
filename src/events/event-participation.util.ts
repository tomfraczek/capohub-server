import { EventRsvpStatus } from './enums/event-rsvp-status.enum';

// RSVP statuses that denote actual participation, not merely an intent to
// attend. Judgment call (no explicit spec): GOING only - MAYBE is an
// unresolved intent, NOT_GOING is an explicit non-attendance. Shared by
// FormalRankService (rank<->Event evidence linking) and
// career-timeline-aggregation.service (EVENT timeline entries) so
// "the user attended this Event" means the same thing everywhere.
export const PARTICIPATING_RSVP_STATUSES: EventRsvpStatus[] = [
  EventRsvpStatus.GOING,
];
