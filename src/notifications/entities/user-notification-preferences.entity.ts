import { Entity, OneToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';

// One row per User - their global notification preferences (module spec
// section 10). A missing row means "every default applies" (see the field
// defaults below and UserNotificationPreferencesService, which creates the
// row lazily only on the first explicit PATCH - same convention as
// CommunityNotificationSettings).
//
// This entity governs *push delivery* only - the in-app inbox itself can
// never be disabled here (module spec: "nie pozwalaj wyłączyć centralnego
// inboxu"), which is why there is deliberately no "inboxEnabled" field at
// all.
@Entity({ tableName: 'user_notification_preferences' })
export class UserNotificationPreferences extends BaseEntity {
  @OneToOne(() => User, { deleteRule: 'cascade', owner: true, unique: true })
  user!: User;

  // Master switch - off means no push at all, on any device, regardless of
  // every other toggle below. The in-app inbox is entirely unaffected.
  @Property()
  pushEnabled: boolean = true;

  // Per-category push toggles (module spec section 10) - SYSTEM has no
  // toggle here on purpose (see NotificationCategory.SYSTEM's own comment
  // and NotificationPushService's safe-default rule for it).
  @Property()
  pushCommunity: boolean = true;

  @Property()
  pushTraining: boolean = true;

  @Property()
  pushEvent: boolean = true;

  @Property()
  pushMembership: boolean = true;

  @Property()
  pushGraduation: boolean = true;

  @Property()
  pushPayment: boolean = true;

  // Reminder-specific toggles - deliberately independent of pushTraining/
  // pushEvent above. Disabling one of these means the corresponding
  // reminder Notification is never even created (see
  // NotificationReminderScheduler) - a reminder is a purely optional
  // signal, never a domain fact that must survive in the inbox regardless
  // of preference (module spec section 30, contrasted with e.g.
  // TRAINING_CANCELLED, which is always created).
  @Property()
  trainingReminder24h: boolean = true;

  @Property()
  trainingReminder2h: boolean = true;

  @Property()
  eventReminder24h: boolean = true;

  @Property()
  eventReminder2h: boolean = true;
}
