import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';
import { Training } from './training.entity';

export const TRAINING_RSVPS_UNIQUE_INDEX =
  'training_rsvps_training_id_user_id_unique';

// One row per (training, user) - unlike EventAttendee, never multiple rows
// per user (a Training RSVP is a single in-place decision, not a
// re-registerable capacity claim - see the module spec §6). The row is
// updated in place on every change and deleted outright when the user
// clears their response (see TrainingRsvpService) - there is deliberately
// no NO_RESPONSE value to fall back to (see training-rsvp-status.enum.ts):
// the absence of a row IS "no response".
@Entity({ tableName: 'training_rsvps' })
@Unique({ name: TRAINING_RSVPS_UNIQUE_INDEX, properties: ['training', 'user'] })
export class TrainingRsvp extends BaseEntity {
  @Index()
  @ManyToOne(() => Training, { deleteRule: 'no action' })
  training!: Training;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Enum({ items: () => Object.values(TrainingRsvpStatus) })
  status!: TrainingRsvpStatus;

  @Property({ type: 'timestamptz' })
  respondedAt: Date = new Date();
}
