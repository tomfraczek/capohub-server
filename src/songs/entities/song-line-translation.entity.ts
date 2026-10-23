import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { SongLine } from './song-line.entity';

@Entity({ tableName: 'song_line_translations' })
@Unique({ properties: ['line', 'languageCode'] })
export class SongLineTranslation extends BaseEntity {
  @ManyToOne(() => SongLine, { deleteRule: 'cascade' })
  line!: SongLine;

  // Lowercase language code (e.g. 'pl', 'en', 'es'). No dedicated Language
  // entity - the valid set isn't enforced by the model at this stage.
  @Index()
  @Property({ length: 10 })
  languageCode!: string;

  @Property({ type: 'text' })
  text!: string;

  // Uncertainty of *this* translation only (one language of one line) -
  // the best justified reading was chosen, but the meaning is not
  // unambiguous. Says nothing about the correctness of the original
  // Portuguese line itself.
  @Property({ default: false })
  isUncertain: boolean = false;
}
