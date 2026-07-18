import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Instrument } from '../../instruments/entities/instrument.entity';
import { Rhythm } from './rhythm.entity';

// Normalized many-to-many between Instrument and Rhythm, CMS-managed only
// (see admin rhythms/instruments endpoints). `roleDescription` is
// deliberately free text, not a LEAD/BASE/ACCOMPANIMENT enum - the role an
// instrument plays in a rhythm can differ by tradition/group.
@Entity({ tableName: 'instrument_rhythms' })
@Unique({ properties: ['instrument', 'rhythm'] })
export class InstrumentRhythm extends BaseEntity {
  @Index()
  @ManyToOne(() => Instrument, { deleteRule: 'cascade' })
  instrument!: Instrument;

  @Index()
  @ManyToOne(() => Rhythm, { deleteRule: 'cascade' })
  rhythm!: Rhythm;

  @Property({ nullable: true, type: 'text' })
  roleDescription: string | null = null;

  @Property()
  displayOrder: number = 0;
}
