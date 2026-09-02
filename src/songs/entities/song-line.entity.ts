import {
  Collection,
  Entity,
  ManyToOne,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { SongLinePhonetic } from './song-line-phonetic.entity';
import { SongLineTranslation } from './song-line-translation.entity';
import { SongPart } from './song-part.entity';

@Entity({ tableName: 'song_lines' })
@Unique({ properties: ['part', 'position'] })
export class SongLine extends BaseEntity {
  @ManyToOne(() => SongPart, { deleteRule: 'cascade' })
  part!: SongPart;

  @Property({ type: 'text' })
  originalText!: string;

  @Property()
  position!: number;

  @OneToMany(() => SongLineTranslation, (translation) => translation.line)
  translations = new Collection<SongLineTranslation>(this);

  // Portuguese phonetics attached directly to this line, one entry per
  // language a moderator/author has filled in (mirrors `translations` above
  // exactly) - never a single flat field, since the same Portuguese line
  // reads differently depending on the reader's own language.
  @OneToMany(() => SongLinePhonetic, (phonetic) => phonetic.line)
  phonetics = new Collection<SongLinePhonetic>(this);
}
