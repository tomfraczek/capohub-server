import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Collection } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Instrument } from '../instruments/entities/instrument.entity';
import { Song } from '../songs/entities/song.entity';
import { CreateRhythmInput } from './dto/create-rhythm.schema';
import { InstrumentRhythm } from './entities/instrument-rhythm.entity';
import { RhythmMedia } from './entities/rhythm-media.entity';
import { Rhythm } from './entities/rhythm.entity';
import { SongRhythm } from './entities/song-rhythm.entity';
import { RhythmsService } from './rhythms.service';

function buildRhythm(overrides: Partial<Rhythm> = {}): Rhythm {
  const rhythm = new Rhythm();
  rhythm.id = 'rhythm-1';
  rhythm.slug = 'sao-bento-grande';
  rhythm.name = 'São Bento Grande';
  rhythm.alternativeNames = [];
  rhythm.media = new Collection<RhythmMedia>(rhythm, []);
  return Object.assign(rhythm, overrides);
}

function buildCreateInput(
  overrides: Partial<CreateRhythmInput> = {},
): CreateRhythmInput {
  return {
    name: 'São Bento Grande',
    alternativeNames: [],
    shortDescription: null,
    description: null,
    history: null,
    usage: null,
    character: null,
    tempoDescription: null,
    tempoMinBpm: null,
    tempoMaxBpm: null,
    displayOrder: 0,
    isActive: true,
    media: [],
    instrumentLinks: [],
    songLinks: [],
    ...overrides,
  };
}

interface MockRouting {
  rhythm?: Rhythm | null;
  slugCount?: number;
  instrumentCount?: number;
  songCount?: number;
  instrumentRhythmCount?: number;
  songRhythmCount?: number;
  conflictingPrimaryRows?: SongRhythm[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });
  const nativeDelete = jest.fn().mockResolvedValue(0);
  const findOne = jest
    .fn()
    .mockResolvedValue(
      routing.rhythm === undefined ? buildRhythm() : routing.rhythm,
    );
  const find = jest
    .fn()
    .mockImplementation((entity: unknown, filter: Record<string, unknown>) => {
      // Only the enforcePrimaryInvariant lookup filters by isPrimary - every
      // other SongRhythm/InstrumentRhythm find() in this service (e.g.
      // loadAllSongsForRhythm's `{ rhythm: id }`) should see an empty result
      // here, since this spec doesn't exercise those read paths.
      if (entity === SongRhythm && filter?.isPrimary === true) {
        return Promise.resolve(routing.conflictingPrimaryRows ?? []);
      }
      return Promise.resolve([]);
    });
  const count = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === Rhythm) {
      return Promise.resolve(routing.slugCount ?? 0);
    }
    if (entity === Instrument) {
      return Promise.resolve(routing.instrumentCount ?? 0);
    }
    if (entity === Song) {
      return Promise.resolve(routing.songCount ?? 0);
    }
    if (entity === InstrumentRhythm) {
      return Promise.resolve(routing.instrumentRhythmCount ?? 0);
    }
    if (entity === SongRhythm) {
      return Promise.resolve(routing.songRhythmCount ?? 0);
    }
    return Promise.resolve(0);
  });
  const getReference = jest
    .fn()
    .mockImplementation((_entity: unknown, id: string) => ({ id }));

  const raw = {
    findOne,
    find,
    count,
    persist,
    remove,
    nativeDelete,
    getReference,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, remove, nativeDelete };
}

describe('RhythmsService', () => {
  describe('create', () => {
    it('throws SLUG_CONFLICT when the slug already exists', async () => {
      const { em } = buildMockEm({ slugCount: 1 });
      const service = new RhythmsService(em);

      const error: unknown = await service
        .create(buildCreateInput({ slug: 'sao-bento-grande' }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'SLUG_CONFLICT',
      });
    });

    it('rejects instrumentLinks referencing a non-existent instrument', async () => {
      const { em } = buildMockEm({ instrumentCount: 0 });
      const service = new RhythmsService(em);

      await expect(
        service.create(
          buildCreateInput({
            instrumentLinks: [
              {
                instrumentId: 'missing',
                roleDescription: null,
                displayOrder: 1,
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects songLinks referencing a non-existent song', async () => {
      const { em } = buildMockEm({ songCount: 0 });
      const service = new RhythmsService(em);

      await expect(
        service.create(
          buildCreateInput({
            songLinks: [
              { songId: 'missing', isPrimary: false, description: null },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects media.instrumentId referencing a non-existent instrument', async () => {
      const { em } = buildMockEm({ instrumentCount: 0 });
      const service = new RhythmsService(em);

      await expect(
        service.create(
          buildCreateInput({
            media: [
              {
                type: 'IMAGE' as never,
                url: 'https://example.com/a.jpg',
                title: null,
                description: null,
                displayOrder: 1,
                instrumentId: 'missing',
              },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('un-primaries any other rhythm holding the primary flag for the same song', async () => {
      const otherRow = new SongRhythm();
      otherRow.isPrimary = true;
      const { em } = buildMockEm({
        instrumentCount: 1,
        songCount: 1,
        conflictingPrimaryRows: [otherRow],
      });
      const service = new RhythmsService(em);

      await service.create(
        buildCreateInput({
          songLinks: [{ songId: 'song-1', isPrimary: true, description: null }],
        }),
      );

      expect(otherRow.isPrimary).toBe(false);
    });

    it('does not touch other rhythms when no songLink is primary', async () => {
      const otherRow = new SongRhythm();
      otherRow.isPrimary = true;
      const { em } = buildMockEm({
        songCount: 1,
        conflictingPrimaryRows: [otherRow],
      });
      const service = new RhythmsService(em);

      await service.create(
        buildCreateInput({
          songLinks: [
            { songId: 'song-1', isPrimary: false, description: null },
          ],
        }),
      );

      // find(SongRhythm, ...) for the primary-conflict check is only called
      // when at least one songLink is primary - otherRow must stay intact.
      expect(otherRow.isPrimary).toBe(true);
    });
  });

  describe('update', () => {
    it('throws NotFoundException when the rhythm does not exist', async () => {
      const { em } = buildMockEm({ rhythm: null });
      const service = new RhythmsService(em);

      await expect(
        service.update('missing-id', buildCreateInput()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('replaces media/instrumentLinks/songLinks wholesale', async () => {
      const existing = buildRhythm();
      const { em, nativeDelete } = buildMockEm({ rhythm: existing });
      const service = new RhythmsService(em);

      await service.update('rhythm-1', buildCreateInput());

      expect(nativeDelete).toHaveBeenCalledWith(RhythmMedia, {
        rhythm: 'rhythm-1',
      });
      expect(nativeDelete).toHaveBeenCalledWith(InstrumentRhythm, {
        rhythm: 'rhythm-1',
      });
      expect(nativeDelete).toHaveBeenCalledWith(SongRhythm, {
        rhythm: 'rhythm-1',
      });
    });
  });

  describe('delete', () => {
    it('throws NotFoundException when the rhythm does not exist', async () => {
      const { em } = buildMockEm({ rhythm: null });
      const service = new RhythmsService(em);

      await expect(service.delete('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('blocks deletion with 409 RHYTHM_HAS_RELATIONS when it has instrument links', async () => {
      const { em } = buildMockEm({ instrumentRhythmCount: 1 });
      const service = new RhythmsService(em);

      const error: unknown = await service
        .delete('rhythm-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'RHYTHM_HAS_RELATIONS',
      });
    });

    it('blocks deletion with 409 RHYTHM_HAS_RELATIONS when it has song links', async () => {
      const { em } = buildMockEm({ songRhythmCount: 1 });
      const service = new RhythmsService(em);

      const error: unknown = await service
        .delete('rhythm-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'RHYTHM_HAS_RELATIONS',
      });
    });

    it('removes the rhythm when it has no links', async () => {
      const { em, remove } = buildMockEm();
      const service = new RhythmsService(em);

      await service.delete('rhythm-1');

      expect(remove).toHaveBeenCalled();
    });
  });
});
