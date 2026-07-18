import { ConflictException, NotFoundException } from '@nestjs/common';
import {
  Collection,
  UniqueConstraintViolationException,
} from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { MusicMediaType } from '../common/enums/music-media-type.enum';
import { CreateInstrumentInput } from './dto/create-instrument.schema';
import { InstrumentMedia } from './entities/instrument-media.entity';
import { Instrument } from './entities/instrument.entity';
import { InstrumentsService } from './instruments.service';

function buildInstrument(overrides: Partial<Instrument> = {}): Instrument {
  const instrument = new Instrument();
  instrument.id = 'instrument-1';
  instrument.slug = 'berimbau';
  instrument.name = 'Berimbau';
  instrument.alternativeNames = [];
  instrument.media = new Collection<InstrumentMedia>(instrument, []);
  return Object.assign(instrument, overrides);
}

function buildCreateInput(
  overrides: Partial<CreateInstrumentInput> = {},
): CreateInstrumentInput {
  return {
    name: 'Berimbau',
    alternativeNames: [],
    shortDescription: null,
    description: null,
    history: null,
    construction: null,
    howToPlay: null,
    roleInBateria: null,
    displayOrder: 0,
    isActive: true,
    media: [],
    ...overrides,
  };
}

interface MockRouting {
  instrument?: Instrument | null;
  slugCount?: number;
  instrumentRhythmCount?: number;
}

// Every mock is returned both wrapped in `em` (typed as EntityManager, for
// passing to the service under test) and unwrapped (as plain jest.Mock, for
// assertions) - asserting via em.persist directly would access a typed
// method reference off EntityManager, which trips
// @typescript-eslint/unbound-method.
function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object[]]>()
    .mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });
  const nativeDelete = jest.fn().mockResolvedValue(0);
  const find = jest.fn().mockResolvedValue([]);
  const findOne = jest
    .fn()
    .mockResolvedValue(
      routing.instrument === undefined ? buildInstrument() : routing.instrument,
    );
  const count = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === Instrument) {
      return Promise.resolve(routing.slugCount ?? 0);
    }
    return Promise.resolve(routing.instrumentRhythmCount ?? 0);
  });

  const raw = {
    findOne,
    find,
    count,
    persist,
    remove,
    nativeDelete,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return {
    em: raw as unknown as EntityManager,
    persist,
    remove,
    nativeDelete,
    flush,
  };
}

describe('InstrumentsService', () => {
  describe('create', () => {
    it('derives the slug from the name when none is supplied', async () => {
      const { em, persist } = buildMockEm();
      const service = new InstrumentsService(em);

      await service.create(buildCreateInput({ name: 'Agogô' }));

      const persistedInstrument = persist.mock.calls[0][0][0] as Instrument;
      expect(persistedInstrument.slug).toBe('agogo');
    });

    it('uses the supplied slug verbatim when provided', async () => {
      const { em, persist } = buildMockEm();
      const service = new InstrumentsService(em);

      await service.create(
        buildCreateInput({ name: 'Agogô', slug: 'custom-slug' }),
      );

      const persistedInstrument = persist.mock.calls[0][0][0] as Instrument;
      expect(persistedInstrument.slug).toBe('custom-slug');
    });

    it('throws a SLUG_CONFLICT ConflictException when the slug already exists', async () => {
      const { em } = buildMockEm({ slugCount: 1 });
      const service = new InstrumentsService(em);

      const error: unknown = await service
        .create(buildCreateInput({ slug: 'berimbau' }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'SLUG_CONFLICT',
      });
    });

    it('maps a race-condition unique violation to a generic CONFLICT', async () => {
      const { em, persist } = buildMockEm();
      persist.mockReturnValue({
        flush: jest
          .fn()
          .mockRejectedValue(
            new UniqueConstraintViolationException(new Error('duplicate')),
          ),
      });
      const service = new InstrumentsService(em);

      const error: unknown = await service
        .create(buildCreateInput())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CONFLICT',
      });
    });
  });

  describe('update', () => {
    it('keeps the existing slug when none is supplied', async () => {
      const existing = buildInstrument({ slug: 'berimbau' });
      const { em } = buildMockEm({ instrument: existing });
      const service = new InstrumentsService(em);

      await service.update('instrument-1', buildCreateInput({ name: 'X' }));

      expect(existing.slug).toBe('berimbau');
    });

    it('replaces media wholesale: deletes old rows before persisting new ones', async () => {
      const existing = buildInstrument();
      const { em, persist, nativeDelete } = buildMockEm({
        instrument: existing,
      });
      const service = new InstrumentsService(em);

      await service.update(
        'instrument-1',
        buildCreateInput({
          media: [
            {
              type: MusicMediaType.IMAGE,
              url: 'https://example.com/a.jpg',
              title: null,
              description: null,
              displayOrder: 1,
            },
          ],
        }),
      );

      expect(nativeDelete).toHaveBeenCalledWith(InstrumentMedia, {
        instrument: 'instrument-1',
      });
      const persistedEntities = persist.mock.calls[0][0];
      expect(
        persistedEntities.some((entity) => entity instanceof InstrumentMedia),
      ).toBe(true);
    });

    it('throws NotFoundException when the instrument does not exist', async () => {
      const { em } = buildMockEm({ instrument: null });
      const service = new InstrumentsService(em);

      await expect(
        service.update('missing-id', buildCreateInput()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the instrument does not exist', async () => {
      const { em } = buildMockEm({ instrument: null });
      const service = new InstrumentsService(em);

      await expect(service.delete('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('blocks deletion with 409 INSTRUMENT_HAS_RELATIONS when linked to a rhythm', async () => {
      const { em, remove } = buildMockEm({ instrumentRhythmCount: 1 });
      const service = new InstrumentsService(em);

      const error: unknown = await service
        .delete('instrument-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'INSTRUMENT_HAS_RELATIONS',
      });
      expect(remove).not.toHaveBeenCalled();
    });

    it('removes the instrument when it has no rhythm links', async () => {
      const { em, remove } = buildMockEm({ instrumentRhythmCount: 0 });
      const service = new InstrumentsService(em);

      await service.delete('instrument-1');

      expect(remove).toHaveBeenCalled();
    });
  });
});
