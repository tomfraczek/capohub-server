import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from './song.entity';
import { Tag } from './tag.entity';

// Explicit join entity (rather than a MikroORM many-to-many pivot) so it
// stays a plain BaseEntity subclass, consistent with every other entity in
// the project.
@Entity({ tableName: 'song_tags' })
@Unique({ properties: ['song', 'tag'] })
export class SongTag extends BaseEntity {
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Index()
  @ManyToOne(() => Tag, { deleteRule: 'cascade' })
  tag!: Tag;
}
