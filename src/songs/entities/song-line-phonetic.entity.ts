import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { SongLine } from './song-line.entity';

@Entity({ tableName: 'song_line_phonetics' })
@Unique({ properties: ['line', 'languageCode'] })
export class SongLinePhonetic extends BaseEntity {
  @ManyToOne(() => SongLine, { deleteRule: 'cascade' })
  line!: SongLine;

  // Lowercase language code (e.g. 'pl', 'en', 'es') - same convention as
  // SongLineTranslation.languageCode. No dedicated Language entity - the
  // valid set isn't enforced by the model at this stage.
  @Index()
  @Property({ length: 10 })
  languageCode!: string;

  @Property({ type: 'text' })
  text!: string;
}
