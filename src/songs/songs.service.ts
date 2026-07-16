import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
// Not a type-only import: Nest's DI resolves the constructor param via this
// runtime symbol (see @mikro-orm/postgresql's EntityManager = SqlEntityManager,
// which adds createQueryBuilder over the plain @mikro-orm/core EntityManager).
import { EntityManager } from '@mikro-orm/postgresql';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { User } from '../users/entities/user.entity';
import {
  CreateSongAlternativeTitleInput,
  CreateSongInput,
  CreateSongMediaInput,
  CreateSongPartInput,
} from './dto/create-song.schema';
import { ListSongsQuery } from './dto/song-list-query.schema';
import { SongDetailsResponseDto } from './dto/song-details-response.dto';
import { SongMediaDetailsResponseDto } from './dto/song-media-details-response.dto';
import { SongSummaryResponseDto } from './dto/song-summary-response.dto';
import { UpdateSongInput } from './dto/update-song.schema';
import { SongAlternativeTitle } from './entities/song-alternative-title.entity';
import { SongCategory } from './entities/song-category.entity';
import { SongLine } from './entities/song-line.entity';
import { SongLineTranslation } from './entities/song-line-translation.entity';
import { SongMedia } from './entities/song-media.entity';
import { SongPart } from './entities/song-part.entity';
import { SongTag } from './entities/song-tag.entity';
import { Song } from './entities/song.entity';
import { Tag } from './entities/tag.entity';
import { SongStatus } from './enums/song-status.enum';
import {
  toSongDetailsResponseDto,
  toSongMediaDetailsResponseDto,
  toSongSummaryResponseDto,
} from './mappers/song.mapper';
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
  constructor(private readonly em: EntityManager) {}

  async create(
    user: User,
    input: CreateSongInput,
  ): Promise<SongDetailsResponseDto> {
    const songId = await this.em.transactional(async (em) => {
      await this.assertSlugAvailable(em, input.slug);
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

    return this.getDetails(songId);
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

      await this.assertSlugAvailable(em, input.slug, song.id);
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

    return this.getDetails(id);
  }

  async getDetails(id: string): Promise<SongDetailsResponseDto> {
    const song = await this.em.findOne(
      Song,
      { id },
      { populate: [...DETAILS_POPULATE] },
    );

    if (!song) {
      throw this.notFound();
    }

    return toSongDetailsResponseDto(song);
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

  async submit(id: string): Promise<SongDetailsResponseDto> {
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

      song.status = SongStatus.PENDING_REVIEW;
      await em.flush();
    });

    return this.getDetails(id);
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

  private async assertSlugAvailable(
    em: EntityManager,
    slug: string,
    excludeSongId?: string,
  ): Promise<void> {
    const existing = await em.findOne(Song, { slug });
    if (existing && existing.id !== excludeSongId) {
      throw new ConflictException({
        code: 'SLUG_CONFLICT',
        message: 'A song with this slug already exists',
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
    song.slug = input.slug;
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
