import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import type { CreateSongInput } from '../dto/create-song.schema';
import { SongEditProposalStatus } from '../enums/song-edit-proposal-status.enum';
import { Song } from './song.entity';

// A proposed replacement for a protected (PUBLISHED/HIDDEN) Song's content -
// see the moderation model audit and SongEditProposalsService. Once a Song
// is protected, ordinary users never mutate it directly again; every further
// change is a SongEditProposal that a moderator must approve.
//
// `payload` is a full snapshot, not a diff - the exact same shape
// SongsService.update()/create() already accept (CreateSongInput), reused
// here as the single source of truth for "what a valid Song looks like" so
// a proposal can never contain something approve() would be unable to apply
// (see SongContentService and create-song.schema.ts's own comment on why
// diffing this aggregate's nested collections would be fragile).
@Entity({ tableName: 'song_edit_proposals' })
@Index({ properties: ['song', 'status'] })
@Index({ properties: ['status', 'createdAt'] })
export class SongEditProposal extends BaseEntity {
  @Index()
  @ManyToOne(() => Song, { deleteRule: 'cascade' })
  song!: Song;

  // Nullable + SET NULL, same physical-delete concern as Song.createdBy: a
  // User can be physically deleted without losing the proposal itself.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  proposedBy: User | null = null;

  @Index()
  @Enum({ items: () => Object.values(SongEditProposalStatus) })
  status: SongEditProposalStatus = SongEditProposalStatus.PENDING;

  // Validated against createSongSchema before being persisted (see
  // SongEditProposalsService.create) - stored as jsonb, never re-validated
  // structurally at approve time (approve() reuses the exact same
  // SongContentService.replaceContent() call that a direct update() uses,
  // which re-resolves categoryId/tagIds against the DB, so a category/tag
  // deactivated *after* the proposal was created is still caught then).
  @Property({ type: 'json' })
  payload!: CreateSongInput;

  @Property({ nullable: true, type: 'text' })
  rejectionReason: string | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  reviewedBy: User | null = null;

  @Property({ nullable: true, type: 'timestamptz' })
  reviewedAt: Date | null = null;
}
