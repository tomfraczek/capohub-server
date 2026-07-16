import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { SongMediaProvider } from '../enums/song-media-provider.enum';
import { Song } from './song.entity';

// External links only (YouTube/Spotify/SoundCloud) - the backend never
// stores audio, video, files or thumbnails.
@Entity({ tableName: 'song_media' })
@Unique({ properties: ['song', 'url'] })
export class SongMedia extends BaseEntity {
  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  @Index()
  @Enum({ items: () => Object.values(SongMediaProvider) })
  provider!: SongMediaProvider;

  @Property({ length: 2048 })
  url!: string;

  @Property({ nullable: true, length: 200 })
  title: string | null = null;

  @Property()
  position!: number;

  // Same physical-delete concern as Song.createdBy: a deleted User must not
  // take their previously-added media links down with them.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy: User | null = null;

  // false: added by a user, not yet checked. true: checked and approved by
  // a moderator. No moderation workflow or endpoint sets this yet - the
  // field only prepares the model for a later stage.
  @Property()
  isVerified: boolean = false;
}
