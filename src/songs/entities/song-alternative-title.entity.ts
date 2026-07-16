import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from './song.entity';

@Entity({ tableName: 'song_alternative_titles' })
@Unique({ properties: ['song', 'title'] })
export class SongAlternativeTitle extends BaseEntity {
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Index()
  @Property({ length: 200 })
  title!: string;

  @Property()
  position!: number;
}
