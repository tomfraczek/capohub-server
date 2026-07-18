import {
  Collection,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  Property,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { PlaylistSong } from './playlist-song.entity';

// Private-only for now (spec: "Nie dodawaj jeszcze playlist publicznych") -
// deliberately no isPublic flag yet. Every playlist is visible only to its
// owner, enforced in PlaylistsService, not here.
@Entity({ tableName: 'playlists' })
export class Playlist extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  owner!: User;

  @Property({ length: 150 })
  name!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @OneToMany(() => PlaylistSong, (playlistSong) => playlistSong.playlist, {
    orderBy: { position: 'ASC' },
  })
  songs = new Collection<PlaylistSong>(this);
}
