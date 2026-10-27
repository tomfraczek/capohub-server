import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import { MetronomeSequence } from './metronome-sequence.entity';

// A metronome sequence shared in a Section: the owner's own sequence, not a
// copy - it stays theirs, and every member of the Section sees its current
// version. Removing the share (or deleting the sequence or the Section)
// removes only this link; copies members already saved are independent.
@Entity({ tableName: 'section_metronome_sequences' })
@Unique({ properties: ['section', 'sequence'] })
@Index({ properties: ['section', 'createdAt'] })
export class SectionMetronomeSequence extends BaseEntity {
  @ManyToOne(() => Section, { deleteRule: 'cascade' })
  section!: Section;

  @Index()
  @ManyToOne(() => MetronomeSequence, { deleteRule: 'cascade' })
  sequence!: MetronomeSequence;

  // Who shared it - always the sequence's owner at the time (only the
  // owner may share), kept even if their Section role changes later.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  sharedBy: User | null = null;
}
