import { Entity, Index, ManyToOne, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { SongMedia } from './song-media.entity';
import { Song } from './song.entity';

// A user's single "best source" pick for a Song. `song` is deliberately
// stored directly here (not derived through `media.song`) so the DB can
// enforce "one active vote per user per song" with a plain unique
// constraint - deriving it via a cross-table constraint isn't something
// Postgres can express with a plain FK, so SongsService is responsible for
// keeping song/media in sync (see SongsService.setMediaVote, which only
// ever loads SongMedia scoped by song.id = songId).
@Entity({ tableName: 'song_media_votes' })
@Unique({ properties: ['song', 'user'] })
export class SongMediaVote extends BaseEntity {
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Index()
  @ManyToOne(() => SongMedia, { deleteRule: 'cascade' })
  media!: SongMedia;

  // No SET NULL: a vote without a user is meaningless, so deleting the user
  // deletes the vote too (unlike Song.createdBy / SongMedia.createdBy).
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;
}
