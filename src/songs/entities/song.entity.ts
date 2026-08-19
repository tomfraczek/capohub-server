import {
  Collection,
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToMany,
  Property,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { SongStatus } from '../enums/song-status.enum';
import { SongAlternativeTitle } from './song-alternative-title.entity';
import { SongCategory } from './song-category.entity';
import { SongMedia } from './song-media.entity';
import { SongPart } from './song-part.entity';
import { SongTag } from './song-tag.entity';

@Entity({ tableName: 'songs' })
@Index({ properties: ['createdAt'] })
export class Song extends BaseEntity {
  @Index()
  @Property({ length: 200 })
  title!: string;

  // The person who wrote the song (e.g. a specific Mestre) - not the
  // CapoHub user who added it. Null means a traditional/unknown author.
  @Property({ nullable: true, length: 150 })
  authorName: string | null = null;

  @Index()
  @Enum({ items: () => Object.values(SongStatus) })
  status: SongStatus = SongStatus.DRAFT;

  // Set by reject() (see SongsService) when a moderator rejects this song
  // from PENDING_REVIEW. Cleared on the next successful submit() - a fresh
  // submission should never carry a stale reason from a previous rejection.
  // Never set for a REJECTED SongEditProposal - that keeps its own
  // rejectionReason instead (see song-edit-proposal.entity.ts), since a
  // proposal rejection must never appear to be a rejection of the Song
  // itself, which stays PUBLISHED/untouched throughout.
  @Property({ nullable: true, type: 'text' })
  rejectionReason: string | null = null;

  @Property({ nullable: true, type: 'text' })
  meaningHistory: string | null = null;

  @Property({ nullable: true, type: 'text' })
  meaningContext: string | null = null;

  @Property({ nullable: true, type: 'text' })
  meaningTrivia: string | null = null;

  @Index()
  @ManyToOne(() => SongCategory)
  category!: SongCategory;

  // Nullable + SET NULL: a User can be physically deleted (see
  // UserService/DELETE /users/me), but that must never cascade-delete
  // published songs. Losing the createdBy attribution is an acceptable
  // trade-off; losing songbook content is not.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy: User | null = null;

  @OneToMany(() => SongAlternativeTitle, (title) => title.song, {
    orderBy: { position: 'ASC' },
  })
  alternativeTitles = new Collection<SongAlternativeTitle>(this);

  @OneToMany(() => SongPart, (part) => part.song, {
    orderBy: { position: 'ASC' },
  })
  parts = new Collection<SongPart>(this);

  @OneToMany(() => SongTag, (songTag) => songTag.song)
  tags = new Collection<SongTag>(this);

  @OneToMany(() => SongMedia, (media) => media.song, {
    orderBy: { position: 'ASC' },
  })
  media = new Collection<SongMedia>(this);
}
