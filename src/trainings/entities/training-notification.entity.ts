import { randomUUID } from 'crypto';
import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { User } from '../../users/entities/user.entity';
import { TrainingNotificationType } from '../enums/training-notification-type.enum';
import { Training } from './training.entity';

// A minimal, in-app-only notification record - same precedent as
// graduation/entities/formal-rank-correction-notification.entity.ts (see
// that entity's own comment): this codebase has no push/email/queue
// delivery infrastructure, so this table only records *that* something
// happened for a recipient to see next time they open the app, never that
// anything was actually pushed/emailed. Deliberately does NOT extend
// BaseEntity - immutable, no `updatedAt`.
@Entity({ tableName: 'training_notifications' })
export class TrainingNotification {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  recipient!: User;

  @Index()
  @ManyToOne(() => Training, { deleteRule: 'cascade' })
  training!: Training;

  @Enum({ items: () => Object.values(TrainingNotificationType) })
  type!: TrainingNotificationType;

  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
