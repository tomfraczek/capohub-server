// What kind of entity `Notification.targetId` refers to - lets the
// frontend resolve a deep link (targetType + targetId -> route) without
// ever storing a route/URL/JSX server-side (module spec section 6).
// Deliberately mirrors AuditTargetType's own "name only what's actually
// targeted" convention - no value here is speculative.
export enum NotificationTargetType {
  TRAINING = 'TRAINING',
  EVENT = 'EVENT',
  ANNOUNCEMENT = 'ANNOUNCEMENT',
  SECTION = 'SECTION',
  GROUP = 'GROUP',
  MEMBERSHIP_REQUEST = 'MEMBERSHIP_REQUEST',
  HIERARCHY_INVITATION = 'HIERARCHY_INVITATION',
  FORMAL_RANK_CORRECTION = 'FORMAL_RANK_CORRECTION',
  // A FormalRankRequest ("Prośba o potwierdzenie stopnia") - contextGroup
  // is the Group whose system the rank is from.
  FORMAL_RANK_REQUEST = 'FORMAL_RANK_REQUEST',
  USER = 'USER',
}
