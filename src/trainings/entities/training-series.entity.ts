import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import { TrainingVisibility } from '../enums/training-visibility.enum';

// The recurrence template/generator for a weekly-recurring Training - never
// a runtime overlay. Every concrete occurrence in range is materialized as
// its own Training row at creation time (see TrainingSeriesService.create);
// this row only holds the *defaults* new/regenerated occurrences are built
// from and the recurrence rule itself (dayOfWeek/startTime/durationMinutes/
// startDate/endDate). A one-off Training (see training.entity.ts) has no
// TrainingSeries at all.
//
// Recurrence is deliberately a fixed "weekly, same day, same time" rule,
// not an RRULE-style language - the module spec explicitly calls for
// nothing richer at this stage.
@Entity({ tableName: 'training_series' })
@Check<TrainingSeries>({
  name: 'training_series_date_range_check',
  expression: (columns) => `"${columns.endDate}" >= "${columns.startDate}"`,
})
export class TrainingSeries extends BaseEntity {
  @Index()
  @ManyToOne(() => Section, { deleteRule: 'no action' })
  section!: Section;

  // 0 = Sunday .. 6 = Saturday (JS Date#getUTCDay convention) - see
  // training-recurrence.util.ts.
  @Property({ type: 'smallint' })
  dayOfWeek!: number;

  // Wall-clock "HH:mm", 24h - combined with each occurrence's own calendar
  // date to build that Training's `startsAt` (see
  // training-recurrence.util.ts). Not a `time` column: every occurrence's
  // real startsAt/endsAt already lives on the Training row itself: this is
  // only ever read back when (re)generating occurrences from the template.
  @Property({ length: 5 })
  startTime!: string;

  @Property({ type: 'integer' })
  durationMinutes!: number;

  // Same 4-field location shape as Event (see event.entity.ts) - the
  // default new/regenerated occurrences are created with; a specific
  // Training may still override its own (see training.entity.ts).
  @Property({ nullable: true, type: 'text' })
  locationName: string | null = null;

  @Property({ nullable: true, type: 'text' })
  locationAddress: string | null = null;

  @Property({ nullable: true, type: 'float' })
  latitude: number | null = null;

  @Property({ nullable: true, type: 'float' })
  longitude: number | null = null;

  // The trainer every generated/regenerated occurrence is created with. A
  // specific Training may still override its own trainer without touching
  // this default (see the module spec §3) - never required to hold a
  // SectionMembership, same as Training.trainer.
  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  defaultTrainer!: User;

  @Property({ nullable: true, type: 'text' })
  defaultDescription: string | null = null;

  @Enum({ items: () => Object.values(TrainingVisibility) })
  visibility: TrainingVisibility = TrainingVisibility.MEMBERS_ONLY;

  @Property()
  allowExternalRsvp: boolean = false;

  // Date-only (stored at UTC midnight) - the first calendar date on/after
  // which occurrences are generated; the actual first occurrence is the
  // first `dayOfWeek` match on or after this date (see
  // training-recurrence.util.ts).
  @Property({ type: 'date' })
  startDate!: Date;

  // Date-only, inclusive - capped to at most 3 years after `startDate` (see
  // create-training-series.schema.ts). Every occurrence through this date
  // is generated eagerly at creation time; there is no lazy "generate on
  // demand" path (see the module spec §1).
  @Property({ type: 'date' })
  endDate!: Date;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy: User | null = null;
}
