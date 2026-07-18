import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { MusicMediaType } from '../../common/enums/music-media-type.enum';
import { BaseEntity } from '../../database/entities/base.entity';
import { Instrument } from '../../instruments/entities/instrument.entity';
import { Rhythm } from './rhythm.entity';

// External links only, same as SongMedia/InstrumentMedia.
@Entity({ tableName: 'rhythm_media' })
@Unique({ properties: ['rhythm', 'url'] })
export class RhythmMedia extends BaseEntity {
  @Index()
  @ManyToOne(() => Rhythm, { deleteRule: 'cascade' })
  rhythm!: Rhythm;

  @Enum({ items: () => Object.values(MusicMediaType) })
  type!: MusicMediaType;

  @Property({ length: 2048 })
  url!: string;

  @Property({ nullable: true, length: 200 })
  title: string | null = null;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Property()
  displayOrder: number = 0;

  // Optional: marks that this recording/clip demonstrates a specific
  // instrument's part within the rhythm. SET NULL (not cascade) - deleting
  // the instrument should not delete the media, only the annotation that
  // links it to that instrument (spec section 4).
  @Index()
  @ManyToOne(() => Instrument, { nullable: true, deleteRule: 'set null' })
  instrument: Instrument | null = null;
}
