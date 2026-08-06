import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { randomUUID } from 'node:crypto';
import { User } from '../../users/entities/user.entity';
import { FormalRankCorrectionNotificationType } from '../enums/formal-rank-correction-notification-type.enum';
import { FormalRankCorrectionRequest } from './formal-rank-correction-request.entity';

// A minimal, in-app-only notification record raised by the formal rank
// correction workflow (see FormalRankCorrectionService) - deliberately
// NOT a general-purpose Notifications module: this codebase has no
// existing notification delivery infrastructure (no push/email/queue -
// see CommunityNotificationSettings's own comment, which explicitly
// scopes itself to *preferences only* and defers actual delivery to "a
// future Notifications module"). Building that module is out of scope
// here, so this is intentionally narrow: one row per (recipient, event),
// queryable, but with no delivery channel and no read/unread state -
// never claim this sends a push notification or an email, because it
// does not.
//
// Deliberately does not extend BaseEntity (no `updatedAt`) - like
// AuditLogEntry, a notification record is immutable once created.
@Entity({ tableName: 'formal_rank_correction_notifications' })
export class FormalRankCorrectionNotification {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  // No delete cascade concern beyond the recipient themself - if their
  // account is deleted, their own notification records have no remaining
  // purpose.
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  recipient!: User;

  @Index()
  @Enum({ items: () => Object.values(FormalRankCorrectionNotificationType) })
  type!: FormalRankCorrectionNotificationType;

  // Cascades with its FormalRankCorrectionRequest - in practice a
  // correction request is never physically deleted, so this never fires,
  // but mirrors the same "no independent meaning" reasoning as that
  // entity's own FK choices.
  @Index()
  @ManyToOne(() => FormalRankCorrectionRequest, { deleteRule: 'cascade' })
  correctionRequest!: FormalRankCorrectionRequest;

  @Index()
  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
