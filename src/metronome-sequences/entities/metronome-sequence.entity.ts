import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { METRONOME_INSTRUMENTS } from '../metronome-sequence.constants';
import type {
  MetronomeInstrument,
  MetronomeStep,
} from '../metronome-sequence.constants';

// A sequence from the app's metronome (Instrumenty mode). Always private to
// its owner; it reaches other people only by being shared in a Section the
// owner manages (see SectionMetronomeSequence), where members can play and
// copy it - enforced in MetronomeSequencesService.
@Entity({ tableName: 'metronome_sequences' })
export class MetronomeSequence extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  owner!: User;

  @Property({ length: 80 })
  title!: string;

  @Enum({ items: () => METRONOME_INSTRUMENTS })
  instrument!: MetronomeInstrument;

  @Property({ type: 'smallint' })
  bpm!: number;

  // Steps shown and played per four-pulse cycle: 4, 8 or 16.
  @Property({ type: 'smallint' })
  division!: number;

  // Always 16 fine steps, validated by saveMetronomeSequenceSchema.
  @Property({ type: 'json' })
  steps!: MetronomeStep[];

  // Set on a copy made with "Zapisz u siebie". The copy is fully
  // independent - these only record where it came from (and keep
  // duplicate copies from being made); deleting the original or its author
  // leaves the copy intact.
  @ManyToOne(() => MetronomeSequence, {
    nullable: true,
    deleteRule: 'set null',
  })
  copiedFrom: MetronomeSequence | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  originalAuthor: User | null = null;
}
