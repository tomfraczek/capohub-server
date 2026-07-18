import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Song } from '../../songs/entities/song.entity';
import { Playlist } from './playlist.entity';

// `position` is a plain 1-based sequence managed entirely by
// PlaylistsService (append-at-end on add, full reassignment on
// PATCH .../songs/order) - no DB-level unique/check constraint on it, since
// a multi-row reorder would otherwise need a temporary offset to avoid
// transiently violating it.
@Entity({ tableName: 'playlist_songs' })
@Unique({ properties: ['playlist', 'song'] })
export class PlaylistSong extends BaseEntity {
  @Index()
  @ManyToOne(() => Playlist, { deleteRule: 'cascade' })
  playlist!: Playlist;

  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Property()
  position!: number;
}
