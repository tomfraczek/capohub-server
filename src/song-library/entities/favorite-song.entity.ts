import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from '../../songs/entities/song.entity';
import { User } from '../../users/entities/user.entity';

// A user's personal bookmark on a Song - purely local to CapoHub, never
// affects the global Song model (Songi są globalne). Cascade on both sides:
// a favorite without its user or its song is meaningless, unlike
// Song.createdBy.
@Entity({ tableName: 'favorite_songs' })
@Unique({ properties: ['user', 'song'] })
export class FavoriteSong extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;
}
