import {
  Collection,
  Entity,
  ManyToOne,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { SongLineTranslation } from './song-line-translation.entity';
import { SongPart } from './song-part.entity';

@Entity({ tableName: 'song_lines' })
@Unique({ properties: ['part', 'position'] })
export class SongLine extends BaseEntity {
  @ManyToOne(() => SongPart, { deleteRule: 'cascade' })
  part!: SongPart;

  @Property({ type: 'text' })
  originalText!: string;

  // Portuguese phonetics attached directly to this line. Optional.
  @Property({ nullable: true, type: 'text' })
  phoneticText: string | null = null;

  @Property()
  position!: number;

  @OneToMany(() => SongLineTranslation, (translation) => translation.line)
  translations = new Collection<SongLineTranslation>(this);
}
