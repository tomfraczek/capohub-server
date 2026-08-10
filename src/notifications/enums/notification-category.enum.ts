// The coarse grouping every NotificationType belongs to (see
// notification-type.enum.ts) - drives preference toggles
// (UserNotificationPreferences.push<Category>) and future UX filtering.
// Never used as an event identifier by itself - see NotificationType for
// the exact thing that happened.
export enum NotificationCategory {
  COMMUNITY = 'COMMUNITY',
  TRAINING = 'TRAINING',
  EVENT = 'EVENT',
  MEMBERSHIP = 'MEMBERSHIP',
  GRADUATION = 'GRADUATION',
  // Reserved for a future payment/billing integration - no NotificationType
  // maps to this yet (no such domain exists in this codebase). Kept so the
  // preference row (pushPayment) and the category enum never need a
  // migration once one does.
  PAYMENT = 'PAYMENT',
  // Reserved for future system-level messages (e.g. maintenance windows).
  // No NotificationType maps to this yet. The inbox itself can never be
  // disabled for SYSTEM (see UserNotificationPreferencesService) and its
  // push follows a safe-by-default rule (see NotificationPushService).
  SYSTEM = 'SYSTEM',
}
