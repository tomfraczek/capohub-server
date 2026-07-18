import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
// Not a type-only import: createQueryBuilder is used for the search filter.
import { EntityManager } from '@mikro-orm/postgresql';
import { slugify } from '../common/utils/slugify';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { InstrumentRhythm } from '../rhythms/entities/instrument-rhythm.entity';
import { loadRhythmsForInstrument } from '../rhythms/instrument-rhythm-links.query';
import { AdminInstrumentListItemDto } from './dto/admin-instrument-list-item.dto';
import { CreateInstrumentInput } from './dto/create-instrument.schema';
import { InstrumentDetailsResponseDto } from './dto/instrument-details-response.dto';
import { InstrumentListItemResponseDto } from './dto/instrument-list-item-response.dto';
import { UpdateInstrumentInput } from './dto/update-instrument.schema';
import { InstrumentMedia } from './entities/instrument-media.entity';
import { Instrument } from './entities/instrument.entity';
import {
  toAdminInstrumentListItemDto,
  toInstrumentDetailsResponseDto,
  toInstrumentListItemResponseDto,
} from './mappers/instrument.mapper';

@Injectable()
export class InstrumentsService {
  constructor(private readonly em: EntityManager) {}

  async listPublic(search?: string): Promise<InstrumentListItemResponseDto[]> {
    const ids = await this.queryOrderedIds(search, false);
    if (ids.length === 0) {
      return [];
    }

    const instruments = await this.em.find(
      Instrument,
      { id: { $in: ids } },
      { populate: ['media'] },
    );
    return this.mapByIdOrder(ids, instruments, toInstrumentListItemResponseDto);
  }

  async getPublicBySlug(slug: string): Promise<InstrumentDetailsResponseDto> {
    const instrument = await this.em.findOne(
      Instrument,
      { slug, isActive: true },
      { populate: ['media'] },
    );
    if (!instrument) {
      throw this.notFound();
    }

    const rhythms = await loadRhythmsForInstrument(this.em, instrument.id, {
      includeInactiveRhythms: false,
    });
    return toInstrumentDetailsResponseDto(instrument, rhythms);
  }

  async adminList(): Promise<AdminInstrumentListItemDto[]> {
    const ids = await this.queryOrderedIds(undefined, true);
    if (ids.length === 0) {
      return [];
    }

    const instruments = await this.em.find(Instrument, { id: { $in: ids } });
    return this.mapByIdOrder(ids, instruments, toAdminInstrumentListItemDto);
  }

  async adminGetById(id: string): Promise<InstrumentDetailsResponseDto> {
    const instrument = await this.em.findOne(
      Instrument,
      { id },
      { populate: ['media'] },
    );
    if (!instrument) {
      throw this.notFound();
    }

    const rhythms = await loadRhythmsForInstrument(this.em, instrument.id, {
      includeInactiveRhythms: true,
    });
    return toInstrumentDetailsResponseDto(instrument, rhythms);
  }

  async create(
    input: CreateInstrumentInput,
  ): Promise<InstrumentDetailsResponseDto> {
    const slug = input.slug ?? slugify(input.name);
    await this.assertSlugAvailable(slug);

    const instrumentId = await this.em.transactional(async (em) => {
      const instrument = new Instrument();
      this.applyFields(instrument, input, slug);

      const media = input.media.map((item) =>
        this.buildMedia(instrument, item),
      );

      await this.persistOrThrowConflict(em, [instrument, ...media]);
      return instrument.id;
    });

    return this.adminGetById(instrumentId);
  }

  async update(
    id: string,
    input: UpdateInstrumentInput,
  ): Promise<InstrumentDetailsResponseDto> {
    await this.em.transactional(async (em) => {
      const instrument = await em.findOne(Instrument, { id });
      if (!instrument) {
        throw this.notFound();
      }

      const slug = input.slug ?? instrument.slug;
      if (slug !== instrument.slug) {
        await this.assertSlugAvailable(slug, id);
      }
      this.applyFields(instrument, input, slug);

      // Replace-all strategy for media, mirroring SongsService.update.
      await em.nativeDelete(InstrumentMedia, { instrument: instrument.id });
      const media = input.media.map((item) =>
        this.buildMedia(instrument, item),
      );

      await this.persistOrThrowConflict(em, [instrument, ...media]);
    });

    return this.adminGetById(id);
  }

  async delete(id: string): Promise<void> {
    await this.em.transactional(async (em) => {
      const instrument = await em.findOne(Instrument, { id });
      if (!instrument) {
        throw this.notFound();
      }

      const relatedRhythmCount = await em.count(InstrumentRhythm, {
        instrument: id,
      });
      if (relatedRhythmCount > 0) {
        throw new ConflictException({
          code: 'INSTRUMENT_HAS_RELATIONS',
          message:
            'Cannot delete an instrument that is still linked to one or more rhythms - remove those links first, or set isActive to false instead',
        });
      }

      // DB-level ON DELETE CASCADE removes every instrument_media row with
      // this single delete. RhythmMedia rows referencing this instrument
      // are SET NULL, not deleted (spec section 4).
      await em.remove(instrument).flush();
    });
  }

  private async queryOrderedIds(
    search: string | undefined,
    includeInactive: boolean,
  ): Promise<string[]> {
    const qb = this.em.createQueryBuilder(Instrument, 'i').select('i.id');

    if (!includeInactive) {
      qb.andWhere({ isActive: true });
    }

    if (search) {
      const term = `%${search.toLowerCase()}%`;
      qb.andWhere(
        `(lower(i.name) like ? or exists (select 1 from unnest(i.alternative_names) alt where lower(alt) like ?))`,
        [term, term],
      );
    }

    qb.orderBy({ displayOrder: 'asc', name: 'asc' });

    const rows = await qb.execute<{ id: string }[]>('all');
    return rows.map((row) => row.id);
  }

  // Re-attaches each already-loaded entity to the id-ordered list computed
  // by queryOrderedIds, so the raw-SQL query stays the single source of
  // truth for ordering (mirrors SongsService.list's ids.flatMap pattern).
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
    instrument: Instrument,
    input: CreateInstrumentInput,
    slug: string,
  ): void {
    instrument.slug = slug;
    instrument.name = input.name;
    instrument.alternativeNames = input.alternativeNames;
    instrument.shortDescription = input.shortDescription;
    instrument.description = input.description;
    instrument.history = input.history;
    instrument.construction = input.construction;
    instrument.howToPlay = input.howToPlay;
    instrument.roleInBateria = input.roleInBateria;
    instrument.displayOrder = input.displayOrder;
    instrument.isActive = input.isActive;
  }

  private buildMedia(
    instrument: Instrument,
    item: CreateInstrumentInput['media'][number],
  ): InstrumentMedia {
    const media = new InstrumentMedia();
    media.instrument = instrument;
    media.type = item.type;
    media.url = item.url;
    media.title = item.title;
    media.description = item.description;
    media.displayOrder = item.displayOrder;
    return media;
  }

  private async assertSlugAvailable(
    slug: string,
    excludeId?: string,
  ): Promise<void> {
    const count = await this.em.count(Instrument, {
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
      message: 'An instrument with this slug already exists',
    });
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'INSTRUMENT_NOT_FOUND',
      message: 'Instrument not found',
    });
  }
}
