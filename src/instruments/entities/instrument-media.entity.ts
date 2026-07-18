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
import { Instrument } from './instrument.entity';

// External links only, same as SongMedia - the backend never hosts audio,
// video, files or thumbnails itself (see InstrumentMediaService/CMS).
@Entity({ tableName: 'instrument_media' })
@Unique({ properties: ['instrument', 'url'] })
export class InstrumentMedia extends BaseEntity {
  @Index()
  @ManyToOne(() => Instrument, { deleteRule: 'cascade' })
  instrument!: Instrument;

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
}
