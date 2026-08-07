// See training-notification.entity.ts - a minimal, in-app-only notification
// record, same precedent as
// graduation/enums/formal-rank-correction-notification-type.enum.ts. This
// codebase has no push/email/queue delivery infrastructure (see that
// entity's own comment) - never claim one of these was pushed or emailed,
// because it was not.
//
// TRAINING_REMINDER is deliberately unused for now: a reminder needs a
// scheduler to fire it ahead of `startsAt`, and this codebase has no
// scheduled-job infrastructure (see event-write-policy.ts's identical
// "lazily reconciled, not cron-driven" precedent) - the value is defined so
// the eventual scheduler integration needs no enum/schema change, but
// nothing in this module writes it yet (see the module's final report).
export enum TrainingNotificationType {
  TRAINING_REMINDER = 'TRAINING_REMINDER',
  TRAINING_CANCELLED = 'TRAINING_CANCELLED',
  TRAINING_TIME_CHANGED = 'TRAINING_TIME_CHANGED',
  TRAINING_LOCATION_CHANGED = 'TRAINING_LOCATION_CHANGED',
  TRAINING_TRAINER_CHANGED = 'TRAINING_TRAINER_CHANGED',
}
