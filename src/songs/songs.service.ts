import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
// Not a type-only import: Nest's DI resolves the constructor param via this
// runtime symbol (see @mikro-orm/postgresql's EntityManager = SqlEntityManager,
// which adds createQueryBuilder over the plain @mikro-orm/core EntityManager).
import { EntityManager } from '@mikro-orm/postgresql';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { PlaylistsService } from '../playlists/playlists.service';
import { FavoriteSongsService } from '../song-library/favorite-songs.service';
import { LearningStatusService } from '../song-library/learning-status.service';
import { SongNotesService } from '../song-library/song-notes.service';
import { User } from '../users/entities/user.entity';
import {
  CreateSongAlternativeTitleInput,
  CreateSongInput,
  CreateSongMediaInput,
  CreateSongPartInput,
} from './dto/create-song.schema';
import { DuplicateSuggestionsResponseDto } from './dto/duplicate-suggestion-response.dto';
import { ListSongsQuery } from './dto/song-list-query.schema';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongMediaDetailsResponseDto } from './dto/song-media-details-response.dto';
import { SongMediaVoteResponseDto } from './dto/song-media-vote-response.dto';
import { SongSummaryResponseDto } from './dto/song-summary-response.dto';
import { UpdateSongInput } from './dto/update-song.schema';
import { SongAlternativeTitle } from './entities/song-alternative-title.entity';
import { SongCategory } from './entities/song-category.entity';
import { SongLine } from './entities/song-line.entity';
import { SongLineTranslation } from './entities/song-line-translation.entity';
import { SongMediaVote } from './entities/song-media-vote.entity';
import { SongMedia } from './entities/song-media.entity';
import { SongPart } from './entities/song-part.entity';
import { SongTag } from './entities/song-tag.entity';
import { Song } from './entities/song.entity';
import { Tag } from './entities/tag.entity';
import { SongStatus } from './enums/song-status.enum';
import {
  SongUserContext,
  toSongDetailsResponseDto,
  toSongMediaDetailsResponseDto,
  toSongSummaryResponseDto,
} from './mappers/song.mapper';
import { loadSongMediaVoteAggregates } from './song-media-vote-aggregates';
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
  ) {}

  async create(
    user: User,
    input: CreateSongInput,
  ): Promise<SongDetailsResponseDto> {
    const songId = await this.em.transactional(async (em) => {
      const category = await this.loadActiveCategoryOrFail(
        em,
        input.categoryId,
      );
      const tags = await this.loadActiveTagsOrFail(em, input.tagIds);

      const song = new Song();
      song.createdBy = user;
      song.status = SongStatus.DRAFT;
      this.applySongFields(song, input, category);

      const children = this.buildChildEntities(song, input, tags, user);

      await this.persistOrThrowConflict(em, [song, ...children]);

      return song.id;
    });

    return this.getDetails(songId, user.id);
  }

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

      const category = await this.loadActiveCategoryOrFail(
        em,
        input.categoryId,
      );
      const tags = await this.loadActiveTagsOrFail(em, input.tagIds);

      this.applySongFields(song, input, category);

      // Replace-all strategy: wipe every child collection, then rebuild it
      // from the request. SongPart's DB-level ON DELETE CASCADE (see the
      // Etap 8.1 migration) takes song_lines and song_line_translations
      // down with it, so there is nothing left to orphan.
      await em.nativeDelete(SongAlternativeTitle, { song: song.id });
      await em.nativeDelete(SongTag, { song: song.id });
      await em.nativeDelete(SongPart, { song: song.id });
      await em.nativeDelete(SongMedia, { song: song.id });

      const children = this.buildChildEntities(song, input, tags, user);

      await this.persistOrThrowConflict(em, [song, ...children]);
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

    const [voteAggregates, userContext] = await Promise.all([
      loadSongMediaVoteAggregates(this.em, id, currentUserId),
      this.loadUserContext(id, currentUserId),
    ]);

    return toSongDetailsResponseDto(song, voteAggregates, userContext);
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

  async publish(id: string): Promise<SongDetailsResponseDto> {
    await this.transitionStatus(
      id,
      [SongStatus.PENDING_REVIEW],
      SongStatus.PUBLISHED,
    );
    return this.getDetails(id);
  }

  async reject(id: string): Promise<SongDetailsResponseDto> {
    await this.transitionStatus(
      id,
      [SongStatus.PENDING_REVIEW],
      SongStatus.REJECTED,
    );
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

  async delete(id: string): Promise<void> {
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

  private async loadActiveCategoryOrFail(
    em: EntityManager,
    categoryId: string,
  ): Promise<SongCategory> {
    const category = await em.findOne(SongCategory, { id: categoryId });
    if (!category || !category.isActive) {
      throw new BadRequestException({
        code: 'INVALID_CATEGORY',
        message: 'categoryId does not reference an active category',
      });
    }
    return category;
  }

  private async loadActiveTagsOrFail(
    em: EntityManager,
    tagIds: string[],
  ): Promise<Tag[]> {
    if (tagIds.length === 0) {
      return [];
    }

    const tags = await em.find(Tag, { id: { $in: tagIds }, isActive: true });
    if (tags.length !== tagIds.length) {
      throw new BadRequestException({
        code: 'INVALID_TAGS',
        message: 'tagIds must all reference active tags',
      });
    }
    return tags;
  }

  private applySongFields(
    song: Song,
    input: CreateSongInput,
    category: SongCategory,
  ): void {
    song.title = input.title;
    song.authorName = input.authorName;
    song.category = category;
    song.meaningHistory = input.meaningHistory;
    song.meaningContext = input.meaningContext;
    song.meaningTrivia = input.meaningTrivia;
  }

  private buildChildEntities(
    song: Song,
    input: CreateSongInput,
    tags: Tag[],
    user: User,
  ): object[] {
    const entities: object[] = [
      ...input.alternativeTitles.map((item) =>
        this.buildAlternativeTitle(song, item),
      ),
      ...tags.map((tag) => this.buildSongTag(song, tag)),
      ...input.media.map((item) => this.buildSongMedia(song, item, user)),
    ];

    for (const partInput of input.parts) {
      const part = this.buildSongPart(song, partInput);
      entities.push(part);

      for (const lineInput of partInput.lines) {
        const line = new SongLine();
        line.part = part;
        line.originalText = lineInput.originalText;
        line.phoneticText = lineInput.phoneticText;
        line.position = lineInput.position;
        entities.push(line);

        for (const translationInput of lineInput.translations) {
          const translation = new SongLineTranslation();
          translation.line = line;
          translation.languageCode = translationInput.languageCode;
          translation.text = translationInput.text;
          entities.push(translation);
        }
      }
    }

    return entities;
  }

  private buildAlternativeTitle(
    song: Song,
    input: CreateSongAlternativeTitleInput,
  ): SongAlternativeTitle {
    const alternativeTitle = new SongAlternativeTitle();
    alternativeTitle.song = song;
    alternativeTitle.title = input.title;
    alternativeTitle.position = input.position;
    return alternativeTitle;
  }

  private buildSongTag(song: Song, tag: Tag): SongTag {
    const songTag = new SongTag();
    songTag.song = song;
    songTag.tag = tag;
    return songTag;
  }

  private buildSongPart(song: Song, input: CreateSongPartInput): SongPart {
    const part = new SongPart();
    part.song = song;
    part.performer = input.performer;
    part.position = input.position;
    return part;
  }

  private buildSongMedia(
    song: Song,
    input: CreateSongMediaInput,
    user: User,
  ): SongMedia {
    const media = new SongMedia();
    media.song = song;
    media.provider = input.provider;
    media.url = input.url;
    media.title = input.title;
    media.position = input.position;
    media.createdBy = user;
    media.isVerified = false;
    return media;
  }

  private async persistOrThrowConflict(
    em: EntityManager,
    entities: object[],
  ): Promise<void> {
    try {
      await em.persist(entities).flush();
    } catch (error) {
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'The request conflicts with existing data',
        });
      }
      throw error;
    }
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'SONG_NOT_FOUND',
      message: 'Song not found',
    });
  }
}
