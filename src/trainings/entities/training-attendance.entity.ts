import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { Training } from './training.entity';

export const TRAINING_ATTENDANCES_UNIQUE_INDEX =
  'training_attendances_training_id_user_id_unique';

// Actual, recorded presence at a Training - a distinct fact from
// TrainingRsvp (declared intent). One row per (training, user), created the
// first time someone with attendance-management authority records a
// decision for that user and updated in place afterwards (never a history
// of re-records - see the module spec §7). `attended` is an explicit
// boolean rather than the row's mere existence meaning "present", so a
// participant can be recorded as an explicit no-show (row exists,
// attended = false) as distinct from never having been checked at all (no
// row).
//
// `recordedBy`/`recordedAt` always identify who actually recorded the
// decision and when - never the subject themselves (see the module spec:
// "Nie pozwalaj uczestnikowi samemu zaznaczać rzeczywistej obecności" -
// enforced in TrainingAttendanceService, not here).
//
// Deliberately shaped so recordAttendance(trainingId, userId, actor) is
// already the complete write primitive a future QR/numericCode resolver can
// call directly once it exists - see TrainingAttendanceService.record.
@Entity({ tableName: 'training_attendances' })
@Unique({
  name: TRAINING_ATTENDANCES_UNIQUE_INDEX,
  properties: ['training', 'user'],
})
export class TrainingAttendance extends BaseEntity {
  @Index()
  @ManyToOne(() => Training, { deleteRule: 'no action' })
  training!: Training;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Property()
  attended: boolean = true;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  recordedBy: User | null = null;

  @Property({ type: 'timestamptz' })
  recordedAt: Date = new Date();
}
