import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
// Not a type-only import: createQueryBuilder is used for the search filter.
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { slugify } from '../common/utils/slugify';
import { Instrument } from '../instruments/entities/instrument.entity';
import { Song } from '../songs/entities/song.entity';
import { AdminRhythmListItemDto } from './dto/admin-rhythm-list-item.dto';
import { CreateRhythmInput } from './dto/create-rhythm.schema';
import { RhythmMediaItemInput } from './dto/rhythm-media-input.schema';
import { InstrumentLinkItemInput } from './dto/instrument-link-input.schema';
import { RhythmDetailsResponseDto } from './dto/rhythm-details-response.dto';
import { RhythmListItemResponseDto } from './dto/rhythm-list-item-response.dto';
import { SongLinkItemInput } from './dto/song-link-input.schema';
import { UpdateRhythmInput } from './dto/update-rhythm.schema';
import { InstrumentRhythm } from './entities/instrument-rhythm.entity';
import { RhythmMedia } from './entities/rhythm-media.entity';
import { Rhythm } from './entities/rhythm.entity';
import { SongRhythm } from './entities/song-rhythm.entity';
import { loadInstrumentsForRhythm } from './instrument-rhythm-links.query';
import {
  loadAllSongsForRhythm,
  loadVisibleSongsForRhythm,
} from './rhythm-song-links.query';
import {
  toAdminRhythmListItemDto,
  toRhythmDetailsResponseDto,
  toRhythmListItemResponseDto,
} from './mappers/rhythm.mapper';

@Injectable()
export class RhythmsService {
  constructor(private readonly em: EntityManager) {}

  async listPublic(
    search: string | undefined,
    instrumentId: string | undefined,
  ): Promise<RhythmListItemResponseDto[]> {
    const ids = await this.queryOrderedIds(search, instrumentId, false);
    if (ids.length === 0) {
      return [];
    }

    const rhythms = await this.em.find(
      Rhythm,
      { id: { $in: ids } },
      { populate: ['media'] },
    );
    return this.mapByIdOrder(ids, rhythms, toRhythmListItemResponseDto);
  }

  async getPublicBySlug(
    slug: string,
    currentUserId: string,
  ): Promise<RhythmDetailsResponseDto> {
    const rhythm = await this.em.findOne(
      Rhythm,
      { slug, isActive: true },
      { populate: ['media'] },
    );
    if (!rhythm) {
      throw this.notFound();
    }

    const [instruments, songs] = await Promise.all([
      loadInstrumentsForRhythm(this.em, rhythm.id, {
        includeInactiveInstruments: false,
      }),
      loadVisibleSongsForRhythm(this.em, rhythm.id, currentUserId),
    ]);
    return toRhythmDetailsResponseDto(rhythm, instruments, songs);
  }

  async adminList(): Promise<AdminRhythmListItemDto[]> {
    const ids = await this.queryOrderedIds(undefined, undefined, true);
    if (ids.length === 0) {
      return [];
    }

    const rhythms = await this.em.find(Rhythm, { id: { $in: ids } });
    return this.mapByIdOrder(ids, rhythms, toAdminRhythmListItemDto);
  }

  async adminGetById(id: string): Promise<RhythmDetailsResponseDto> {
    const rhythm = await this.em.findOne(
      Rhythm,
      { id },
      { populate: ['media'] },
    );
    if (!rhythm) {
      throw this.notFound();
    }

    const [instruments, songs] = await Promise.all([
      loadInstrumentsForRhythm(this.em, rhythm.id, {
        includeInactiveInstruments: true,
      }),
      loadAllSongsForRhythm(this.em, rhythm.id),
    ]);
    return toRhythmDetailsResponseDto(rhythm, instruments, songs);
  }

  async create(input: CreateRhythmInput): Promise<RhythmDetailsResponseDto> {
    const slug = input.slug ?? slugify(input.name);
    await this.assertSlugAvailable(slug);

    const rhythmId = await this.em.transactional(async (em) => {
      await this.validateInstrumentIds(
        em,
        input.instrumentLinks.map((link) => link.instrumentId),
      );
      await this.validateSongIds(
        em,
        input.songLinks.map((link) => link.songId),
      );
      await this.validateMediaInstrumentIds(em, input.media);

      const rhythm = new Rhythm();
      this.applyFields(rhythm, input, slug);

      const entities = this.buildChildEntities(em, rhythm, input);
      await this.persistOrThrowConflict(em, [rhythm, ...entities]);
      await this.enforcePrimaryInvariant(em, rhythm.id, input.songLinks);

      return rhythm.id;
    });

    return this.adminGetById(rhythmId);
  }

  async update(
    id: string,
    input: UpdateRhythmInput,
  ): Promise<RhythmDetailsResponseDto> {
    await this.em.transactional(async (em) => {
      const rhythm = await em.findOne(Rhythm, { id });
      if (!rhythm) {
        throw this.notFound();
      }

      const slug = input.slug ?? rhythm.slug;
      if (slug !== rhythm.slug) {
        await this.assertSlugAvailable(slug, id);
      }

      await this.validateInstrumentIds(
        em,
        input.instrumentLinks.map((link) => link.instrumentId),
      );
      await this.validateSongIds(
        em,
        input.songLinks.map((link) => link.songId),
      );
      await this.validateMediaInstrumentIds(em, input.media);

      this.applyFields(rhythm, input, slug);

      // Replace-all strategy for media/instrumentLinks/songLinks, mirroring
      // SongsService.update (spec section 10).
      await em.nativeDelete(RhythmMedia, { rhythm: rhythm.id });
      await em.nativeDelete(InstrumentRhythm, { rhythm: rhythm.id });
      await em.nativeDelete(SongRhythm, { rhythm: rhythm.id });

      const entities = this.buildChildEntities(em, rhythm, input);
      await this.persistOrThrowConflict(em, [rhythm, ...entities]);
      await this.enforcePrimaryInvariant(em, rhythm.id, input.songLinks);
    });

    return this.adminGetById(id);
  }

  async delete(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      const rhythm = await em.findOne(Rhythm, { id });
      if (!rhythm) {
        throw this.notFound();
      }

      const [instrumentLinkCount, songLinkCount] = await Promise.all([
        em.count(InstrumentRhythm, { rhythm: id }),
        em.count(SongRhythm, { rhythm: id }),
      ]);
      if (instrumentLinkCount > 0 || songLinkCount > 0) {
        throw new ConflictException({
          code: 'RHYTHM_HAS_RELATIONS',
          message:
            'Cannot delete a rhythm that is still linked to one or more instruments or songs - remove those links first, or set isActive to false instead',
        });
      }

      // DB-level ON DELETE CASCADE removes every rhythm_media row with this
      // single delete.
      await em.remove(rhythm).flush();
    });
  }

  private buildChildEntities(
    em: EntityManager,
    rhythm: Rhythm,
    input: CreateRhythmInput,
  ): object[] {
    return [
      ...input.media.map((item) => this.buildMedia(em, rhythm, item)),
      ...input.instrumentLinks.map((item) =>
        this.buildInstrumentLink(em, rhythm, item),
      ),
      ...input.songLinks.map((item) => this.buildSongLink(em, rhythm, item)),
    ];
  }

  // Setting a songLink as primary must leave at most one primary rhythm
  // for that song overall (spec section 6/14) - a cross-rhythm invariant
  // that can't be checked at the Zod layer (see song-link-input.schema.ts).
  // Runs inside the same transaction as the write that can violate it: any
  // other rhythm's SongRhythm row for the same song is simply un-primaried,
  // never rejected - "last write wins", same spirit as
  // SongsService.setMediaVote's one-vote-per-user reassignment.
  private async enforcePrimaryInvariant(
    em: EntityManager,
    rhythmId: string,
    songLinks: readonly SongLinkItemInput[],
  ): Promise<void> {
    const primarySongIds = songLinks
      .filter((link) => link.isPrimary)
      .map((link) => link.songId);
    if (primarySongIds.length === 0) {
      return;
    }

    const conflicting = await em.find(SongRhythm, {
      song: { $in: primarySongIds },
      rhythm: { $ne: rhythmId },
      isPrimary: true,
    });
    if (conflicting.length === 0) {
      return;
    }

    for (const row of conflicting) {
      row.isPrimary = false;
    }
    await em.flush();
  }

  private async validateInstrumentIds(
    em: EntityManager,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const uniqueIds = [...new Set(ids)];
    const count = await em.count(Instrument, { id: { $in: uniqueIds } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException({
        code: 'INVALID_INSTRUMENT_IDS',
        message: 'instrumentLinks must all reference existing instruments',
      });
    }
  }

  private async validateSongIds(
    em: EntityManager,
    ids: string[],
  ): Promise<void> {
    if (ids.length === 0) {
      return;
    }
    const uniqueIds = [...new Set(ids)];
    const count = await em.count(Song, { id: { $in: uniqueIds } });
    if (count !== uniqueIds.length) {
      throw new BadRequestException({
        code: 'INVALID_SONG_IDS',
        message: 'songLinks must all reference existing songs',
      });
    }
  }

  private async validateMediaInstrumentIds(
    em: EntityManager,
    media: readonly RhythmMediaItemInput[],
  ): Promise<void> {
    const ids = [
      ...new Set(
        media
          .map((item) => item.instrumentId)
          .filter((id): id is string => id !== null),
      ),
    ];
    if (ids.length === 0) {
      return;
    }
    const count = await em.count(Instrument, { id: { $in: ids } });
    if (count !== ids.length) {
      throw new BadRequestException({
        code: 'INVALID_MEDIA_INSTRUMENT_ID',
        message: 'media.instrumentId must reference an existing instrument',
      });
    }
  }

  private async queryOrderedIds(
    search: string | undefined,
    instrumentId: string | undefined,
    includeInactive: boolean,
  ): Promise<string[]> {
    const qb = this.em.createQueryBuilder(Rhythm, 'r').select('r.id');

    if (!includeInactive) {
      qb.andWhere({ isActive: true });
    }

    if (search) {
      const term = `%${search.toLowerCase()}%`;
      qb.andWhere(
        `(lower(r.name) like ? or exists (select 1 from unnest(r.alternative_names) alt where lower(alt) like ?))`,
        [term, term],
      );
    }

    if (instrumentId) {
      qb.andWhere(
        `exists (select 1 from instrument_rhythms ir where ir.rhythm_id = r.id and ir.instrument_id = ?)`,
        [instrumentId],
      );
    }

    qb.orderBy({ displayOrder: 'asc', name: 'asc' });

    const rows = await qb.execute<{ id: string }[]>('all');
    return rows.map((row) => row.id);
  }

  // Mirrors InstrumentsService.mapByIdOrder - the raw-SQL query stays the
  // single source of truth for ordering.
  private mapByIdOrder<T extends { id: string }, R>(
    ids: string[],
    entities: T[],
    map: (entity: T) => R,
  ): R[] {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    return ids.flatMap((id) => {
      const entity = byId.get(id);
      return entity ? [map(entity)] : [];
    });
  }

  private applyFields(
    rhythm: Rhythm,
    input: CreateRhythmInput,
    slug: string,
  ): void {
    rhythm.slug = slug;
    rhythm.name = input.name;
    rhythm.alternativeNames = input.alternativeNames;
    rhythm.shortDescription = input.shortDescription;
    rhythm.description = input.description;
    rhythm.history = input.history;
    rhythm.usage = input.usage;
    rhythm.character = input.character;
    rhythm.tempoDescription = input.tempoDescription;
    rhythm.tempoMinBpm = input.tempoMinBpm;
    rhythm.tempoMaxBpm = input.tempoMaxBpm;
    rhythm.displayOrder = input.displayOrder;
    rhythm.isActive = input.isActive;
  }

  private buildMedia(
    em: EntityManager,
    rhythm: Rhythm,
    item: RhythmMediaItemInput,
  ): RhythmMedia {
    const media = new RhythmMedia();
    media.rhythm = rhythm;
    media.type = item.type;
    media.url = item.url;
    media.title = item.title;
    media.description = item.description;
    media.displayOrder = item.displayOrder;
    media.instrument = item.instrumentId
      ? em.getReference(Instrument, item.instrumentId)
      : null;
    return media;
  }

  private buildInstrumentLink(
    em: EntityManager,
    rhythm: Rhythm,
    item: InstrumentLinkItemInput,
  ): InstrumentRhythm {
    const link = new InstrumentRhythm();
    link.rhythm = rhythm;
    link.instrument = em.getReference(Instrument, item.instrumentId);
    link.roleDescription = item.roleDescription;
    link.displayOrder = item.displayOrder;
    return link;
  }

  private buildSongLink(
    em: EntityManager,
    rhythm: Rhythm,
    item: SongLinkItemInput,
  ): SongRhythm {
    const link = new SongRhythm();
    link.rhythm = rhythm;
    link.song = em.getReference(Song, item.songId);
    link.isPrimary = item.isPrimary;
    link.description = item.description;
    return link;
  }

  private async assertSlugAvailable(
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const count = await this.em.count(Rhythm, {
      slug,
      ...(excludeId ? { id: { $ne: excludeId } } : {}),
    });
    if (count > 0) {
      throw this.slugConflict();
    }
  }

  private async persistOrThrowConflict(
    em: EntityManager,
    entities: object[],
  ): Promise<void> {
    try {
      await em.persist(entities).flush();
    } catch (error) {
      if (isUniqueViolationOn(error, '_slug_unique')) {
        throw this.slugConflict();
      }
      if (error instanceof UniqueConstraintViolationException) {
        throw new ConflictException({
          code: 'CONFLICT',
          message: 'The request conflicts with existing data',
        });
      }
      throw error;
    }
  }

  private slugConflict(): ConflictException {
    return new ConflictException({
      code: 'SLUG_CONFLICT',
      message: 'A rhythm with this slug already exists',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'RHYTHM_NOT_FOUND',
      message: 'Rhythm not found',
    });
  }
}
