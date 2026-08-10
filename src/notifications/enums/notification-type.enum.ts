import { NotificationCategory } from './notification-category.enum';

// The exact thing that happened - always paired with a NotificationCategory
// (see NOTIFICATION_CATEGORY_BY_TYPE below, the single source of truth for
// that pairing so a caller can never persist a (category, type) mismatch).
// Every value here corresponds to a real, already-implemented domain event
// this codebase actually raises - this enum does not invent new business
// behavior, only names what is notified (same convention as AuditAction).
export enum NotificationType {
  // Training (see TrainingNotificationsService / trainings.service.ts /
  // training-series.service.ts) - recipients are the Section's active
  // members plus qualifying external RSVP holders, exactly as before this
  // module's introduction (see that service's own comment).
  TRAINING_CANCELLED = 'TRAINING_CANCELLED',
  TRAINING_TIME_CHANGED = 'TRAINING_TIME_CHANGED',
  TRAINING_LOCATION_CHANGED = 'TRAINING_LOCATION_CHANGED',
  TRAINING_TRAINER_CHANGED = 'TRAINING_TRAINER_CHANGED',
  TRAINING_REMINDER_24H = 'TRAINING_REMINDER_24H',
  TRAINING_REMINDER_2H = 'TRAINING_REMINDER_2H',

  // Event (see EventNotificationsService / events.service.ts /
  // event-invitations.service.ts) - recipients are the Event's own
  // EventAttendee.subjectUser rows (registered participants only, never
  // "everyone who can merely view the Event").
  EVENT_INVITATION = 'EVENT_INVITATION',
  EVENT_CANCELLED = 'EVENT_CANCELLED',
  EVENT_TIME_CHANGED = 'EVENT_TIME_CHANGED',
  EVENT_LOCATION_CHANGED = 'EVENT_LOCATION_CHANGED',
  EVENT_REMINDER_24H = 'EVENT_REMINDER_24H',
  EVENT_REMINDER_2H = 'EVENT_REMINDER_2H',

  // Announcement (see AnnouncementsService.create).
  ANNOUNCEMENT_PUBLISHED = 'ANNOUNCEMENT_PUBLISHED',
  IMPORTANT_ANNOUNCEMENT_PUBLISHED = 'IMPORTANT_ANNOUNCEMENT_PUBLISHED',

  // Section membership (see MembershipRequestsService) - the
  // CommunityNotificationSettings field each maps to for per-Section push
  // suppression is documented on NotificationPushService's own mapping.
  SECTION_JOIN_REQUEST_RECEIVED = 'SECTION_JOIN_REQUEST_RECEIVED',
  SECTION_JOIN_REQUEST_APPROVED = 'SECTION_JOIN_REQUEST_APPROVED',
  SECTION_JOIN_REQUEST_REJECTED = 'SECTION_JOIN_REQUEST_REJECTED',
  SECTION_INVITATION_RECEIVED = 'SECTION_INVITATION_RECEIVED',
  SECTION_INVITATION_ACCEPTED = 'SECTION_INVITATION_ACCEPTED',
  SECTION_INVITATION_REJECTED = 'SECTION_INVITATION_REJECTED',

  // Hierarchy invitation (see HierarchyManagementService).
  HIERARCHY_INVITATION_RECEIVED = 'HIERARCHY_INVITATION_RECEIVED',
  HIERARCHY_INVITATION_ACCEPTED = 'HIERARCHY_INVITATION_ACCEPTED',
  HIERARCHY_INVITATION_REJECTED = 'HIERARCHY_INVITATION_REJECTED',

  // Formal rank correction (see FormalRankCorrectionService) - carried over
  // 1:1 from the removed FormalRankCorrectionNotificationType, same
  // recipients, same meaning.
  FORMAL_RANK_CORRECTION_REQUIRED = 'FORMAL_RANK_CORRECTION_REQUIRED',
  FORMAL_RANK_CORRECTION_SUBMITTED = 'FORMAL_RANK_CORRECTION_SUBMITTED',
  FORMAL_RANK_CORRECTION_APPROVED = 'FORMAL_RANK_CORRECTION_APPROVED',
  FORMAL_RANK_CORRECTION_REJECTED = 'FORMAL_RANK_CORRECTION_REJECTED',
}

export const NOTIFICATION_CATEGORY_BY_TYPE: Readonly<
  Record<NotificationType, NotificationCategory>
> = {
  [NotificationType.TRAINING_CANCELLED]: NotificationCategory.TRAINING,
  [NotificationType.TRAINING_TIME_CHANGED]: NotificationCategory.TRAINING,
  [NotificationType.TRAINING_LOCATION_CHANGED]: NotificationCategory.TRAINING,
  [NotificationType.TRAINING_TRAINER_CHANGED]: NotificationCategory.TRAINING,
  [NotificationType.TRAINING_REMINDER_24H]: NotificationCategory.TRAINING,
  [NotificationType.TRAINING_REMINDER_2H]: NotificationCategory.TRAINING,

  [NotificationType.EVENT_INVITATION]: NotificationCategory.EVENT,
  [NotificationType.EVENT_CANCELLED]: NotificationCategory.EVENT,
  [NotificationType.EVENT_TIME_CHANGED]: NotificationCategory.EVENT,
  [NotificationType.EVENT_LOCATION_CHANGED]: NotificationCategory.EVENT,
  [NotificationType.EVENT_REMINDER_24H]: NotificationCategory.EVENT,
  [NotificationType.EVENT_REMINDER_2H]: NotificationCategory.EVENT,

  [NotificationType.ANNOUNCEMENT_PUBLISHED]: NotificationCategory.COMMUNITY,
  [NotificationType.IMPORTANT_ANNOUNCEMENT_PUBLISHED]:
    NotificationCategory.COMMUNITY,

  [NotificationType.SECTION_JOIN_REQUEST_RECEIVED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.SECTION_JOIN_REQUEST_APPROVED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.SECTION_JOIN_REQUEST_REJECTED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.SECTION_INVITATION_RECEIVED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.SECTION_INVITATION_ACCEPTED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.SECTION_INVITATION_REJECTED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.HIERARCHY_INVITATION_RECEIVED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.HIERARCHY_INVITATION_ACCEPTED]:
    NotificationCategory.MEMBERSHIP,
  [NotificationType.HIERARCHY_INVITATION_REJECTED]:
    NotificationCategory.MEMBERSHIP,

  [NotificationType.FORMAL_RANK_CORRECTION_REQUIRED]:
    NotificationCategory.GRADUATION,
  [NotificationType.FORMAL_RANK_CORRECTION_SUBMITTED]:
    NotificationCategory.GRADUATION,
  [NotificationType.FORMAL_RANK_CORRECTION_APPROVED]:
    NotificationCategory.GRADUATION,
  [NotificationType.FORMAL_RANK_CORRECTION_REJECTED]:
    NotificationCategory.GRADUATION,
};
