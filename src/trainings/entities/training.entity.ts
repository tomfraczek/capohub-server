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
import { TrainingStatus } from '../enums/training-status.enum';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import { TrainingSeries } from './training-series.entity';

// One concrete occurrence of a Section's training, on one exact date/time -
// the source of truth for that date, whether it was generated from a
// TrainingSeries or created as a genuine one-off (`series === null`). A
// Training is never itself called an Event - it is a distinct domain
// concept (see the module spec's own framing) and is never persisted as
// one.
//
// Scoped edits (THIS/THIS_AND_FOLLOWING/ALL - see TrainingEditScope and
// TrainingSeriesService) always write directly onto this row (or a batch of
// these rows); TrainingSeries itself is only ever read to build/rebuild
// them, never treated as a runtime overlay a reader has to merge with this
// row to know the truth.
@Entity({ tableName: 'trainings' })
@Index({ properties: ['section', 'startsAt'] })
@Index({ properties: ['series', 'startsAt'] })
@Index({ properties: ['trainer', 'startsAt'] })
@Index({ properties: ['status', 'startsAt'] })
@Check<Training>({
  name: 'trainings_starts_before_ends_check',
  expression: (columns) => `"${columns.startsAt}" < "${columns.endsAt}"`,
})
export class Training extends BaseEntity {
  @Index()
  @ManyToOne(() => Section, { deleteRule: 'no action' })
  section!: Section;

  // Null for a genuine one-off Training - never required (see the module
  // spec §1/§10).
  @ManyToOne(() => TrainingSeries, { nullable: true, deleteRule: 'no action' })
  series: TrainingSeries | null = null;

  @Property({ type: 'timestamptz' })
  startsAt!: Date;

  @Property({ type: 'timestamptz' })
  endsAt!: Date;

  // Same 4-field location shape as Event/TrainingSeries - always this
  // Training's own copy, even when generated from a series (see the
  // entity-level comment: this row is the source of truth for its own
  // date, not a diff against the series).
  @Property({ nullable: true, type: 'text' })
  locationName: string | null = null;

  @Property({ nullable: true, type: 'text' })
  locationAddress: string | null = null;

  // Optional (module: "prowadzący opcjonalny... jeśli nie zaznaczony to nie
  // pokazuje w szczegółach treningu kto prowadzi") - `null` means no one is
  // assigned, shown as such, never silently defaulted to the creator. When
  // present, may or may not hold a SectionMembership for `section` (see the
  // module spec §3). Overriding just this Training's trainer never touches
  // the owning TrainingSeries.defaultTrainer.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'no action' })
  trainer: User | null = null;

  // Public - visible to anyone who may see this Training at all (see
  // TrainingVisibility).
  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  // Private - the trainer's own plan for this Training. Visible only to
  // this Training's trainer and to Section OWNER/ADMIN/INSTRUCTOR (see
  // GroupPermission.TRAINING_PRIVATE_NOTES_MANAGE) - never surfaced in a
  // participant-facing DTO (see mappers/training.mapper.ts).
  @Property({ nullable: true, type: 'text' })
  trainingPlan: string | null = null;

  // Private - the trainer's note written after the Training happened. Same
  // visibility rule as trainingPlan; deliberately not a second, differently
  // named field per note "category" (see the module spec §2).
  @Property({ nullable: true, type: 'text' })
  trainerNotes: string | null = null;

  // Also governs whether a non-member may RSVP: PUBLIC means anyone may,
  // MEMBERS_ONLY means only active Section members may (module: "skoro
  // publiczna to mogą się zapisywać osoby spoza sekcji" - there is no
  // separate opt-in, PUBLIC alone is sufficient - enforced in
  // TrainingAccessService.canRsvp, not the DB).
  @Index()
  @Enum({ items: () => Object.values(TrainingVisibility) })
  visibility: TrainingVisibility = TrainingVisibility.MEMBERS_ONLY;

  @Index()
  @Enum({ items: () => Object.values(TrainingStatus) })
  status: TrainingStatus = TrainingStatus.SCHEDULED;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy: User | null = null;
}
