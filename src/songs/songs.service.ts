import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
// Not a type-only import: Nest's DI resolves the constructor param via this
// runtime symbol (see @mikro-orm/postgresql's EntityManager = SqlEntityManager,
// which adds createQueryBuilder over the plain @mikro-orm/core EntityManager).
import { EntityManager } from '@mikro-orm/postgresql';
import { Permission } from '../auth/permissions/permission.enum';
import { PermissionService } from '../auth/permissions/permission.service';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { PlaylistsService } from '../playlists/playlists.service';
import { loadRhythmsForSong } from '../rhythms/song-rhythm-links.query';
import { FavoriteSongsService } from '../song-library/favorite-songs.service';
import { LearningStatusService } from '../song-library/learning-status.service';
import { SongNotesService } from '../song-library/song-notes.service';
import { User } from '../users/entities/user.entity';
import { CreateSongInput } from './dto/create-song.schema';
import { DuplicateSuggestionsResponseDto } from './dto/duplicate-suggestion-response.dto';
import { ModerationReasonInput } from './dto/moderation-reason.schema';
import { ListSongsQuery } from './dto/song-list-query.schema';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongMediaDetailsResponseDto } from './dto/song-media-details-response.dto';
import { SongMediaVoteResponseDto } from './dto/song-media-vote-response.dto';
import { SongSummaryResponseDto } from './dto/song-summary-response.dto';
import { UpdateSongInput } from './dto/update-song.schema';
import { SongMediaVote } from './entities/song-media-vote.entity';
import { SongMedia } from './entities/song-media.entity';
import { Song } from './entities/song.entity';
import { SongStatus } from './enums/song-status.enum';
import {
  SongUserContext,
  toSongDetailsResponseDto,
  toSongMediaDetailsResponseDto,
  toSongSummaryResponseDto,
} from './mappers/song.mapper';
import { loadSongMediaVoteAggregates } from './song-media-vote-aggregates';
import { SongContentService } from './song-content.service';
import { SongDuplicateService } from './song-duplicate.service';
import {
  loadSongSummaryAggregates,
  queryVisibleSongIds,
} from './songs-list-query';

const DETAILS_POPULATE = [
  'category',
  'createdBy',
  'alternativeTitles',
  'tags.tag',
  'parts.lines.translations',
  'media.createdBy',
] as const;

@Injectable()
export class SongsService {
  private readonly logger = new Logger(SongsService.name);

  constructor(
    private readonly em: EntityManager,
    private readonly songDuplicateService: SongDuplicateService,
    private readonly favoriteSongsService: FavoriteSongsService,
    private readonly learningStatusService: LearningStatusService,
    private readonly songNotesService: SongNotesService,
    private readonly playlistsService: PlaylistsService,
    private readonly songContentService: SongContentService,
    private readonly permissionService: PermissionService,
  ) {}

  // Permission-gated at the controller (SONG_CREATE - see
  // songs.controller.ts) - nothing further to check here, a brand-new Song
  // has no owner yet to compare against.
  async create(
    user: User,
    input: CreateSongInput,
  ): Promise<SongDetailsResponseDto> {
    const songId = await this.em.transactional(async (em) => {
      const song = new Song();
      song.createdBy = user;
      song.status = SongStatus.DRAFT;

      await this.songContentService.replaceContent(em, song, input, user);

      return song.id;
    });

    return this.getDetails(songId, user.id);
  }

  // Direct, immediate edit - only ever legal for a Song that isn't
  // protected content yet (DRAFT/REJECTED, see assertDirectlyEditable) and
  // only for someone entitled to touch it (assertCanEditDirectly). A
  // PUBLISHED/HIDDEN Song can never be reached through this method again -
  // see SongEditProposalsService for how it is edited instead.
  async update(
    id: string,
    user: User,
    input: UpdateSongInput,
  ): Promise<SongDetailsResponseDto> {
    await this.em.transactional(async (em) => {
      const song = await em.findOne(Song, { id });
      if (!song) {
        throw this.notFound();
      }

      this.assertDirectlyEditable(song);
      this.assertCanEditDirectly(song, user);

      await this.songContentService.replaceContent(em, song, input, user);
    });

    return this.getDetails(id, user.id);
  }

  // currentUserId is only known for a real GET /songs/:id (see the
  // controller) or right after the acting user's own create/update. Every
  // other internal caller (submit/publish/reject/hide/restore) doesn't have
  // a meaningful "current viewer" to compute isVotedByCurrentUser against,
  // so it defaults to null - voteCount is unaffected either way, since it
  // never depends on the caller's identity.
  async getDetails(
    id: string,
    currentUserId: string | null = null,
  ): Promise<SongDetailsResponseDto> {
    const song = await this.em.findOne(
      Song,
      { id },
      { populate: [...DETAILS_POPULATE] },
    );

    if (!song) {
      throw this.notFound();
    }

    const [voteAggregates, userContext, rhythms] = await Promise.all([
      loadSongMediaVoteAggregates(this.em, id, currentUserId),
      this.loadUserContext(id, currentUserId),
      loadRhythmsForSong(this.em, id),
    ]);

    return toSongDetailsResponseDto(song, voteAggregates, userContext, rhythms);
  }

  // Every field is private to currentUserId (spec section 6). currentUserId
  // is null for internal callers with no meaningful "current viewer" (see
  // the comment on getDetails' parameter) - in that case every field
  // defaults to its "nothing here" value, exactly like
  // loadSongMediaVoteAggregates' isVotedByCurrentUser.
  private async loadUserContext(
    songId: string,
    currentUserId: string | null,
  ): Promise<SongUserContext> {
    if (!currentUserId) {
      return {
        isFavorite: false,
        learningStatus: null,
        myNote: null,
        playlists: [],
      };
    }

    const [isFavorite, learningStatus, note, playlists] = await Promise.all([
      this.favoriteSongsService.isFavorite(currentUserId, songId),
      this.learningStatusService.getStatus(currentUserId, songId),
      this.songNotesService.getNote(currentUserId, songId),
      this.playlistsService.getPlaylistsContainingSong(currentUserId, songId),
    ]);

    return {
      isFavorite,
      learningStatus,
      myNote: note?.content ?? null,
      playlists,
    };
  }

  async list(
    user: User,
    query: ListSongsQuery,
  ): Promise<PaginatedResponse<SongSummaryResponseDto>> {
    const { ids, totalItems } = await queryVisibleSongIds(
      this.em,
      user.id,
      query,
    );

    if (ids.length === 0) {
      return {
        data: [],
        meta: createPaginationMeta({
          page: query.page,
          limit: query.limit,
          totalItems,
        }),
      };
    }

    const [songs, aggregates] = await Promise.all([
      this.em.find(
        Song,
        { id: { $in: ids } },
        { populate: ['category', 'tags.tag', 'createdBy'] },
      ),
      loadSongSummaryAggregates(this.em, ids),
    ]);

    const songsById = new Map(songs.map((song) => [song.id, song]));
    const data = ids.flatMap((id) => {
      const song = songsById.get(id);
      if (!song) {
        return [];
      }
      return [
        toSongSummaryResponseDto(song, {
          hasPhonetics: aggregates.phoneticSongIds.has(song.id),
          hasMedia: aggregates.mediaSongIds.has(song.id),
          translationLanguages:
            aggregates.translationLanguagesBySongId.get(song.id) ?? [],
        }),
      ];
    });

    return {
      data,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems,
      }),
    };
  }

  async submit(id: string, user: User): Promise<SongDetailsResponseDto> {
    await this.em.transactional(async (em) => {
      const song = await em.findOne(
        Song,
        { id },
        { populate: ['category', 'parts.lines'] },
      );
      if (!song) {
        throw this.notFound();
      }

      this.assertValidTransition(song.status, [
        SongStatus.DRAFT,
        SongStatus.REJECTED,
      ]);
      this.assertCanEditDirectly(song, user);
      this.assertReadyForReview(song);

      // Duplicate check runs inside the same transaction as the status
      // change and flush (spec section 21): the candidate query, the
      // status write and the commit all happen atomically from this
      // service's point of view. That does not add a table- or row-level
      // lock, so it does not fully rule out two near-simultaneous submits
      // of the same new song both passing the check before either commits
      // - see the Etap report for why a heavier lock isn't justified here.
      const duplicates = await this.songDuplicateService.findBlockingDuplicates(
        em,
        user.id,
        song,
      );
      if (duplicates.length > 0) {
        this.logger.warn(
          `Blocked submit of song ${song.id}: likely duplicate of ${duplicates
            .map(
              (d) => `${d.id} (similarity=${d.similarity}, status=${d.status})`,
            )
            .join(', ')}`,
        );
        throw new ConflictException({
          code: 'DUPLICATE_SONG',
          message: 'A very similar song already exists.',
          duplicates,
        });
      }

      song.status = SongStatus.PENDING_REVIEW;
      // A fresh submission should never carry a stale reason from a
      // previous rejection - see Song.rejectionReason's own comment.
      song.rejectionReason = null;
      await em.flush();
    });

    return this.getDetails(id);
  }

  async getDuplicateSuggestions(
    user: User,
    title: string,
    limit: number,
  ): Promise<DuplicateSuggestionsResponseDto> {
    const items = await this.songDuplicateService.findSuggestions(
      this.em,
      user.id,
      title,
      limit,
    );
    return { items };
  }

  // CONTENT_APPROVE-gated at the controller (songs.controller.ts) - but a
  // permission alone is not enough: assertNotSelfApproval below additionally
  // blocks the song's own creator, even one who happens to also hold
  // CONTENT_APPROVE (e.g. a MODERATOR reviewing their own submission). See
  // the moderation model's "author never self-approves" rule.
  async publish(id: string, actor: User): Promise<SongDetailsResponseDto> {
    await this.em.transactional(async (em) => {
      const song = await em.findOne(Song, { id });
      if (!song) {
        throw this.notFound();
      }
      this.assertValidTransition(song.status, [SongStatus.PENDING_REVIEW]);
      this.assertNotSelfApproval(song, actor);
      song.status = SongStatus.PUBLISHED;
      await em.flush();
    });
    return this.getDetails(id);
  }

  async reject(
    id: string,
    actor: User,
    input: ModerationReasonInput,
  ): Promise<SongDetailsResponseDto> {
    await this.em.transactional(async (em) => {
      const song = await em.findOne(Song, { id });
      if (!song) {
        throw this.notFound();
      }
      this.assertValidTransition(song.status, [SongStatus.PENDING_REVIEW]);
      this.assertNotSelfApproval(song, actor);
      song.status = SongStatus.REJECTED;
      song.rejectionReason = input.reason;
      await em.flush();
    });
    return this.getDetails(id);
  }

  async hide(id: string): Promise<SongDetailsResponseDto> {
    await this.transitionStatus(id, [SongStatus.PUBLISHED], SongStatus.HIDDEN);
    return this.getDetails(id);
  }

  async restore(id: string): Promise<SongDetailsResponseDto> {
    await this.transitionStatus(id, [SongStatus.HIDDEN], SongStatus.PUBLISHED);
    return this.getDetails(id);
  }

  // DRAFT/REJECTED only (never PUBLISHED/PENDING_REVIEW/HIDDEN - protected
  // content is never removable through this endpoint, by anyone, see the
  // moderation model). Within that, either the song's own creator, or
  // someone holding SONG_DELETE (there is no dedicated "delete own"
  // permission in the model - ownership alone is sufficient for one's own
  // not-yet-published work, mirroring how create() itself already gates on
  // SONG_CREATE before a Song can exist to own in the first place).
  async delete(id: string, actor: User): Promise<void> {
    await this.em.transactional(async (em) => {
      const song = await em.findOne(Song, { id });
      if (!song) {
        throw this.notFound();
      }

      if (
        song.status !== SongStatus.DRAFT &&
        song.status !== SongStatus.REJECTED
      ) {
        throw new ConflictException({
          code: 'SONG_NOT_DELETABLE',
          message: `Cannot delete a song with status ${song.status}`,
        });
      }

      const isOwner = song.createdBy?.id === actor.id;
      const canDeleteAny = this.permissionService.hasPermission(
        actor.globalRole,
        Permission.SONG_DELETE,
      );
      if (!isOwner && !canDeleteAny) {
        throw new ForbiddenException({
          code: 'SONG_NOT_OWNED',
          message: 'You may only delete your own draft or rejected songs',
        });
      }

      // DB-level ON DELETE CASCADE removes every child row (parts, lines,
      // translations, alternative titles, tags, media) with this single delete.
      await em.remove(song).flush();
    });
  }

  async verifyMedia(
    songId: string,
    mediaId: string,
  ): Promise<SongMediaDetailsResponseDto> {
    return this.setMediaVerified(songId, mediaId, true);
  }

  async unverifyMedia(
    songId: string,
    mediaId: string,
  ): Promise<SongMediaDetailsResponseDto> {
    return this.setMediaVerified(songId, mediaId, false);
  }

  // A user has zero or exactly one vote per song (song+user is unique - see
  // the SongMediaVote entity), so "vote for media X" is really "point my
  // one song-level vote at X", not "add a vote to X".
  async setMediaVote(
    songId: string,
    mediaId: string,
    user: User,
  ): Promise<SongMediaVoteResponseDto> {
    await this.em.transactional(async (em) => {
      const media = await em.findOne(SongMedia, { id: mediaId, song: songId });
      if (!media) {
        throw new NotFoundException({
          code: 'SONG_MEDIA_NOT_FOUND',
          message: 'Song media not found',
        });
      }

      const existingVote = await em.findOne(SongMediaVote, {
        song: songId,
        user: user.id,
      });

      if (!existingVote) {
        await this.createVoteOrRecoverFromRace(em, songId, media, user);
      } else if (existingVote.media.id !== mediaId) {
        existingVote.media = media;
        await em.flush();
      }
      // else: existingVote already points at mediaId - idempotent no-op.
    });

    return this.buildVoteResponse(songId, mediaId, user.id);
  }

  async removeMediaVote(songId: string, user: User): Promise<void> {
    await this.em.transactional(async (em) => {
      const vote = await em.findOne(SongMediaVote, {
        song: songId,
        user: user.id,
      });
      if (vote) {
        await em.remove(vote).flush();
      }
      // else: no-op - DELETE is idempotent, see the controller (204 either way).
    });
  }

  // The song+user unique constraint is what actually prevents two
  // concurrent first-votes from both succeeding - this only turns the loser
  // of that race into a graceful "update to the requested media" instead of
  // a raw 500 from an unhandled UniqueConstraintViolationException. No
  // SELECT ... FOR UPDATE or app-level locking: the constraint is the lock.
  private async createVoteOrRecoverFromRace(
    em: EntityManager,
    songId: string,
    media: SongMedia,
    user: User,
  ): Promise<void> {
    const vote = new SongMediaVote();
    vote.song = media.song;
    vote.media = media;
    vote.user = user;

    try {
      await em.persist(vote).flush();
    } catch (error) {
      if (!(error instanceof UniqueConstraintViolationException)) {
        throw error;
      }

      const raceVote = await em.findOneOrFail(SongMediaVote, {
        song: songId,
        user: user.id,
      });
      if (raceVote.media.id !== media.id) {
        raceVote.media = media;
        await em.flush();
      }
    }
  }

  private async buildVoteResponse(
    songId: string,
    mediaId: string,
    currentUserId: string,
  ): Promise<SongMediaVoteResponseDto> {
    const aggregates = await loadSongMediaVoteAggregates(
      this.em,
      songId,
      currentUserId,
    );

    return {
      songId,
      mediaId,
      voteCount: aggregates.voteCountsByMediaId.get(mediaId) ?? 0,
      isVotedByCurrentUser: aggregates.votedMediaId === mediaId,
    };
  }

  // Scoping the lookup by both id and song in one query - rather than
  // fetching by mediaId alone and checking song.id afterwards - is what
  // makes "media exists but belongs to a different song" indistinguishable
  // from "media doesn't exist", which is the point: neither leaks anything
  // about media the caller didn't ask for by songId.
  //
  // Wrapped in em.transactional for consistency with every other mutation
  // in this service, even though a single-field UPDATE is already atomic on
  // its own - see the Etap 8.2.1 report for this call.
  private async setMediaVerified(
    songId: string,
    mediaId: string,
    isVerified: boolean,
  ): Promise<SongMediaDetailsResponseDto> {
    return this.em.transactional(async (em) => {
      const media = await em.findOne(SongMedia, {
        id: mediaId,
        song: songId,
      });

      if (!media) {
        throw new NotFoundException({
          code: 'SONG_MEDIA_NOT_FOUND',
          message: 'Song media not found',
        });
      }

      if (media.isVerified !== isVerified) {
        media.isVerified = isVerified;
        await em.flush();
      }

      return toSongMediaDetailsResponseDto(media);
    });
  }

  private async transitionStatus(
    id: string,
    allowedFrom: SongStatus[],
    to: SongStatus,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const song = await em.findOne(Song, { id });
      if (!song) {
        throw this.notFound();
      }

      this.assertValidTransition(song.status, allowedFrom);
      song.status = to;
      await em.flush();
    });
  }

  private assertValidTransition(
    current: SongStatus,
    allowedFrom: SongStatus[],
  ): void {
    if (!allowedFrom.includes(current)) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot perform this transition from status ${current}`,
      });
    }
  }

  private assertReadyForReview(song: Song): void {
    const problems: string[] = [];

    if (!song.title.trim()) {
      problems.push('title is required');
    }
    if (!song.category.isActive) {
      problems.push('an active category is required');
    }

    const parts = song.parts.getItems();
    if (parts.length === 0) {
      problems.push('at least one part is required');
    }
    for (const part of parts) {
      const lines = part.lines.getItems();
      if (lines.length === 0) {
        problems.push('every part must have at least one line');
      }
      if (lines.some((line) => !line.originalText.trim())) {
        problems.push('every line must have originalText');
      }
    }

    if (problems.length > 0) {
      throw new ConflictException({
        code: 'SONG_NOT_READY_FOR_REVIEW',
        message: `Song is not ready for review: ${problems.join('; ')}`,
      });
    }
  }

  // Guards update()/submit() against a protected Song - once PUBLISHED or
  // HIDDEN, a Song is never mutated directly by anyone again (see
  // SongEditProposalsService), and PENDING_REVIEW is excluded too so a
  // direct update can never bypass an already-in-flight review by racing
  // it - there is deliberately no parallel "update while under review"
  // workflow.
  private assertDirectlyEditable(song: Song): void {
    if (song.status === SongStatus.PENDING_REVIEW) {
      throw new ConflictException({
        code: 'SONG_UNDER_REVIEW',
        message:
          'This song is pending review and cannot be edited until it is published or rejected',
      });
    }
    if (
      song.status === SongStatus.PUBLISHED ||
      song.status === SongStatus.HIDDEN
    ) {
      throw new ConflictException({
        code: 'SONG_PROTECTED',
        message:
          'Published content cannot be edited directly - submit a SongEditProposal instead',
      });
    }
  }

  // Row-level ownership check backing update()/submit() on a DRAFT/REJECTED
  // Song: its own creator needs SONG_EDIT_OWN, anyone else needs
  // SONG_EDIT_ANY. Deliberately checked here (not just declaratively at the
  // controller), since "own vs. any" can only be resolved once the Song's
  // createdBy is known.
  private assertCanEditDirectly(song: Song, actor: User): void {
    const isOwner = song.createdBy?.id === actor.id;
    const required = isOwner
      ? Permission.SONG_EDIT_OWN
      : Permission.SONG_EDIT_ANY;
    if (!this.permissionService.hasPermission(actor.globalRole, required)) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_SONG_PERMISSIONS',
        message: isOwner
          ? 'Editing your own song requires the SONG_EDIT_OWN permission'
          : "Editing another user's song requires the SONG_EDIT_ANY permission",
      });
    }
  }

  // Backs publish()/reject(): the song's own creator may never approve or
  // reject their own submission, even when they separately hold
  // CONTENT_APPROVE (e.g. a MODERATOR reviewing their own draft) - see the
  // moderation model's self-approval rule.
  private assertNotSelfApproval(song: Song, actor: User): void {
    if (song.createdBy?.id === actor.id) {
      throw new ForbiddenException({
        code: 'SELF_APPROVAL_FORBIDDEN',
        message: 'You cannot publish or reject a song you submitted yourself',
      });
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'SONG_NOT_FOUND',
      message: 'Song not found',
    });
  }
}
