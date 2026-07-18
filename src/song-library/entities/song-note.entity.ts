import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from '../../songs/entities/song.entity';
import { User } from '../../users/entities/user.entity';

// A user's private note about a Song - never visible to other users, never
// affects the global Song model. One row per user+song, upserted by
// PUT /songs/:songId/my-note (see SongNotesService.upsertNote).
@Entity({ tableName: 'song_notes' })
@Unique({ properties: ['user', 'song'] })
export class SongNote extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Property({ type: 'text' })
  content!: string;
}
