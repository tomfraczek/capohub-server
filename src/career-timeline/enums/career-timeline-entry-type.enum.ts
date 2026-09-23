// Stable, frontend-facing "kind of milestone" for a career-timeline item -
// replaces the old CareerTimelineCategory, which conflated "what happened"
// with "where it came from" (see CareerTimelineOrigin for the latter). The
// same type can occur with either origin: e.g. JOINED_GROUP is SYSTEM when
// derived from a FormalGroupAffiliation, or MANUAL when the user logs a
// group CapoHub has no record of.
export enum CareerTimelineEntryType {
  START_TRAINING = 'START_TRAINING',
  BATIZADO = 'BATIZADO',
  RECEIVED_APELIDO = 'RECEIVED_APELIDO',
  RECEIVED_RANK = 'RECEIVED_RANK',
  JOINED_GROUP = 'JOINED_GROUP',
  LEFT_GROUP = 'LEFT_GROUP',
  STARTED_TEACHING = 'STARTED_TEACHING',
  STARTED_SECTION = 'STARTED_SECTION',
  FOUNDED_GROUP = 'FOUNDED_GROUP',
  IMPORTANT_EVENT = 'IMPORTANT_EVENT',
  ACHIEVEMENT = 'ACHIEVEMENT',
  OTHER = 'OTHER',
}

// Manual-only types: never derivable from another CapoHub source, so the
// aggregation service never builds one of these itself - see
// CareerTimelineAggregationService.
export const MANUAL_ONLY_ENTRY_TYPES: CareerTimelineEntryType[] = [
  CareerTimelineEntryType.BATIZADO,
  CareerTimelineEntryType.RECEIVED_APELIDO,
  CareerTimelineEntryType.IMPORTANT_EVENT,
  CareerTimelineEntryType.ACHIEVEMENT,
  CareerTimelineEntryType.OTHER,
];

// Whether an item was computed at read time from another CapoHub source
// (SYSTEM) or persisted by the user themselves (MANUAL). Never stored as a
// column - every CareerTimelineEntry row is MANUAL by construction (it's
// the only thing ever written there); every aggregated item is SYSTEM.
export enum CareerTimelineOrigin {
  SYSTEM = 'SYSTEM',
  MANUAL = 'MANUAL',
}

// How much of `occurredOn` the user actually knows/entered. A DAY-precision
// value has a real day-of-month; MONTH and YEAR normalize to the 1st of the
// month/year for storage and sorting, but the original precision is kept so
// the frontend never displays a fabricated day/month. Every SYSTEM item is
// DAY - it always comes from a real recorded timestamp.
export enum CareerTimelinePrecision {
  YEAR = 'YEAR',
  MONTH = 'MONTH',
  DAY = 'DAY',
}
