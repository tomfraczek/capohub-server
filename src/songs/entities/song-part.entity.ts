import {
  Collection,
  Entity,
  Enum,
  ManyToOne,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { SongPerformer } from '../enums/song-performer.enum';
import { SongLine } from './song-line.entity';
import { Song } from './song.entity';

@Entity({ tableName: 'song_parts' })
@Unique({ properties: ['song', 'position'] })
export class SongPart extends BaseEntity {
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Enum({ items: () => Object.values(SongPerformer) })
  performer!: SongPerformer;

  @Property()
  position!: number;

  @OneToMany(() => SongLine, (line) => line.part, {
    orderBy: { position: 'ASC' },
  })
  lines = new Collection<SongLine>(this);
}
