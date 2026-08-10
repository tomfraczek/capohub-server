import { randomUUID } from 'node:crypto';
import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
  Unique,
} from '@mikro-orm/core';
import { Group } from '../../groups/entities/group.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import { NotificationCategory } from '../enums/notification-category.enum';
import { NotificationTargetType } from '../enums/notification-target-type.enum';
import { NotificationType } from '../enums/notification-type.enum';

export const NOTIFICATIONS_DEDUPLICATION_KEY_UNIQUE_INDEX =
  'notifications_deduplication_key_unique';

// The single central record for every notification this app ever raises
// for a user (module spec, section 2 - "JEDEN centralny system"). Push is
// never a separate source of truth: whether or not a push is ever
// successfully delivered, this row is what the in-app inbox reads (see
// NotificationsService) and what GET /notifications/unread-count counts.
//
// title/body are short, ready-to-display Polish text generated at creation
// time by the domain integration that raised this notification (see e.g.
// notification-text.util.ts) - this codebase has no frontend localization
// convention for backend-originated strings (verified: no i18n layer
// exists on either side), so pre-rendering text here, once, is the single
// model chosen for this module (module spec section 5's "wybierz JEDEN
// model"). Never JSX/HTML, never a frontend route/URL - see targetType/
// targetId below for how the frontend still knows where to navigate.
@Entity({ tableName: 'notifications' })
@Index({ properties: ['recipient', 'createdAt'] })
@Index({ properties: ['recipient', 'readAt'] })
export class Notification {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  recipient!: User;

  @Enum({ items: () => Object.values(NotificationCategory) })
  category!: NotificationCategory;

  @Index()
  @Enum({ items: () => Object.values(NotificationType) })
  type!: NotificationType;

  @Property({ length: 200 })
  title!: string;

  @Property({ type: 'text' })
  body!: string;

  // Deep-link target - see notification-target-type.enum.ts. Both null for
  // a notification with nothing to navigate to (none exist yet, but the
  // shape allows it). No FK: targetId is polymorphic across several tables
  // depending on targetType, same convention as AuditLogEntry.targetId.
  @Property({ nullable: true, type: 'string' })
  targetType: NotificationTargetType | null = null;

  @Property({ type: 'uuid', nullable: true })
  targetId: string | null = null;

  // Which Group/Section this notification belongs to, if any - used only
  // for per-community push muting (see NotificationPushService) and
  // optional future filtering, never for authorization: opening the
  // underlying target resource still goes through that resource's own
  // normal access control regardless of what is stored here (module spec
  // section 40). Exactly one of these is ever set, mirroring Announcement/
  // Event's own community-reference split - never enforced by a DB check
  // constraint here since both legitimately stay null for a notification
  // with no community context (e.g. a formal rank correction, which is
  // Section-scoped through targetType/targetId's own Section instead).
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'cascade' })
  contextGroup: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'cascade' })
  contextSection: Section | null = null;

  // Purely informational "who did this" - never checked for authorization.
  // Null for system-generated notifications (e.g. reminders) that have no
  // human actor.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  actor: User | null = null;

  // Only set by the reminder scheduler (module spec section 27) - the
  // stable key `TRAINING_REMINDER_24H:<trainingId>:<recipientId>` etc. that
  // makes a scheduler tick idempotent even if it runs twice concurrently or
  // is restarted mid-window. A plain unique index on a nullable column is
  // sufficient here: Postgres treats every NULL as distinct, so ordinary
  // (non-reminder) notifications - which never set this - never collide
  // with one another.
  @Unique({ name: NOTIFICATIONS_DEDUPLICATION_KEY_UNIQUE_INDEX })
  @Property({ nullable: true, length: 200 })
  deduplicationKey: string | null = null;

  // null = unread, a Date = read (module spec section 7) - never a
  // separate boolean, so "when was it read" is never lost.
  @Property({ type: 'timestamptz', nullable: true })
  readAt: Date | null = null;

  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
