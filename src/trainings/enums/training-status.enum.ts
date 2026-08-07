// A Training's own lifecycle status - a business object concept, not a
// Group concept (mirrors Event's own `status`, asserted inline in
// training-write-policy.ts - not GroupStatus, which GroupPermissionsGuard
// enforces centrally for the owning Section).
//
// Deliberately no COMPLETED status: whether a Training is "past" is always
// derivable from `startsAt`/`endsAt` vs now (same read-model-is-not-
// authoritative reasoning as Event.isMultiDay), so storing a third status
// would only ever risk drifting from the dates that already answer that
// question. CANCELLED is the only state transition a Training can ever
// make - once cancelled, always cancelled (see training-write-policy.ts).
export enum TrainingStatus {
  SCHEDULED = 'SCHEDULED',
  CANCELLED = 'CANCELLED',
}
