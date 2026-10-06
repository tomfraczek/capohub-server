import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Collection } from '@mikro-orm/core';
import { User } from '../users/entities/user.entity';
import { CustomUserRankService } from './custom-user-rank.service';
import { CustomUserRank } from './entities/custom-user-rank.entity';
import { RankTrack } from './enums/rank-track.enum';

function buildUser(id = 'user-1'): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildInput(overrides: Record<string, unknown> = {}) {
  return {
    name: 'My own cordão',
    description: null,
    track: RankTrack.ADULT,
    cordSegments: [{ position: 1, colorHex: '#FF0000', proportion: 100 }],
    ...overrides,
  };
}

function buildCustomRank(
  overrides: Partial<CustomUserRank> = {},
): CustomUserRank {
  const customRank = new CustomUserRank();
  customRank.id = 'rank-1';
  customRank.name = 'Mine';
  customRank.description = null;
  customRank.track = RankTrack.ADULT;
  customRank.cordSegments = new Collection<never>(customRank);
  return Object.assign(customRank, overrides);
}

interface MockRouting {
  customRank?: CustomUserRank | null;
  flushError?: unknown;
  // Whether the caller has an active formal Group (independent rank
  // read-only then).
  hasFormalGroup?: boolean;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockImplementation(() => {
    if (routing.flushError) {
      return Promise.reject(routing.flushError);
    }
    return Promise.resolve(undefined);
  });
  const persist = jest.fn().mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === CustomUserRank) {
      return Promise.resolve(
        routing.customRank === undefined ? null : routing.customRank,
      );
    }
    return Promise.resolve(null);
  });

  const count = jest.fn(() => Promise.resolve(routing.hasFormalGroup ? 1 : 0));

  const raw: Record<string, unknown> = {
    findOne,
    persist,
    flush,
    remove,
    count,
  };
  raw.transactional = jest.fn((cb: (em: unknown) => unknown) => cb(raw));

  return { em: raw as unknown as EntityManager, persist, flush, remove };
}

describe('CustomUserRankService', () => {
  describe('getCurrent', () => {
    it('throws CUSTOM_RANK_NOT_SET when the caller has none', async () => {
      const { em } = buildMockEm({ customRank: null });
      const service = new CustomUserRankService(em);

      const promise = service.getCurrent('user-1');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CUSTOM_RANK_NOT_SET' },
      });
    });

    it('returns the caller row when it exists', async () => {
      const { em } = buildMockEm({ customRank: buildCustomRank() });
      const service = new CustomUserRankService(em);

      const result = await service.getCurrent('user-1');
      expect(result.id).toBe('rank-1');
    });
  });

  describe('getCurrentOrNull', () => {
    it('returns null instead of throwing when unset', async () => {
      const { em } = buildMockEm({ customRank: null });
      const service = new CustomUserRankService(em);

      const result = await service.getCurrentOrNull('user-1');
      expect(result).toBeNull();
    });

    it('returns the raw entity when set', async () => {
      const customRank = buildCustomRank();
      const { em } = buildMockEm({ customRank });
      const service = new CustomUserRankService(em);

      const result = await service.getCurrentOrNull('user-1');
      expect(result).toBe(customRank);
    });
  });

  describe('setCurrent', () => {
    it('creates a fresh row when the caller has none yet', async () => {
      const { em, persist } = buildMockEm({ customRank: null });
      const service = new CustomUserRankService(em);

      const result = await service.setCurrent(buildUser(), buildInput());

      expect(persist).toHaveBeenCalled();
      expect(result.name).toBe('My own cordão');
      expect(result.cordSegments).toEqual([
        { position: 1, colorHex: '#FF0000', proportion: 100 },
      ]);
    });

    it('converts a concurrent-create race into CUSTOM_RANK_ALREADY_SET', async () => {
      const { em } = buildMockEm({
        customRank: null,
        flushError: new UniqueConstraintViolationException(
          new Error(
            'duplicate key value violates unique constraint "custom_user_ranks_user_id_active_unique"',
          ),
        ),
      });
      const service = new CustomUserRankService(em);

      const promise = service.setCurrent(buildUser(), buildInput());

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CUSTOM_RANK_ALREADY_SET' },
      });
    });

    // A different rank (name/track/cord) is a new stint - the previous one
    // stays as history (ended), never overwritten.
    it('ends the previous independent rank and starts a new stint when the rank itself changes', async () => {
      const existing = buildCustomRank({
        name: 'Old name',
        track: RankTrack.CHILD,
      });
      const { em, persist, remove } = buildMockEm({ customRank: existing });
      const service = new CustomUserRankService(em);

      const result = await service.setCurrent(
        buildUser(),
        buildInput({
          name: 'New name',
          track: RankTrack.ADULT,
          cordSegments: [{ position: 1, colorHex: '#00FF00', proportion: 100 }],
          startedOn: '2021-03-01',
        }),
      );

      expect(existing.endedOn).not.toBeNull();
      expect(existing.name).toBe('Old name');
      expect(remove).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalled();
      expect(result.id).not.toBe('rank-1');
      expect(result.name).toBe('New name');
      expect(result.startedOn).toBe('2021-03-01');
    });

    it('edits only the description of the same rank in place', async () => {
      const existing = buildCustomRank({ name: 'My own cordão' });
      const { em, persist } = buildMockEm({ customRank: existing });
      const service = new CustomUserRankService(em);

      const result = await service.setCurrent(
        buildUser(),
        buildInput({ cordSegments: [], description: 'Opis' }),
      );

      expect(result.id).toBe('rank-1');
      expect(existing.endedOn).toBeNull();
      expect(existing.description).toBe('Opis');
      expect(persist).not.toHaveBeenCalled();
    });

    it('is read-only while the caller belongs to a formal Group', async () => {
      const { em, persist } = buildMockEm({
        customRank: buildCustomRank(),
        hasFormalGroup: true,
      });
      const service = new CustomUserRankService(em);

      const promise = service.setCurrent(buildUser(), buildInput());

      await expect(promise).rejects.toMatchObject({
        response: { code: 'INDEPENDENT_RANK_LOCKED_BY_FORMAL_GROUP' },
      });
      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe('deleteCurrent', () => {
    it('ends the caller row instead of deleting it - it stays in their history', async () => {
      const customRank = buildCustomRank();
      const { em, remove } = buildMockEm({ customRank });
      const service = new CustomUserRankService(em);

      await service.deleteCurrent(buildUser());
      expect(remove).not.toHaveBeenCalled();
      expect(customRank.endedOn).not.toBeNull();
    });

    it('is refused while the caller belongs to a formal Group', async () => {
      const customRank = buildCustomRank();
      const { em } = buildMockEm({ customRank, hasFormalGroup: true });
      const service = new CustomUserRankService(em);

      await expect(service.deleteCurrent(buildUser())).rejects.toMatchObject({
        response: { code: 'INDEPENDENT_RANK_LOCKED_BY_FORMAL_GROUP' },
      });
      expect(customRank.endedOn).toBeNull();
    });

    it('throws CUSTOM_RANK_NOT_SET when the caller has none', async () => {
      const { em } = buildMockEm({ customRank: null });
      const service = new CustomUserRankService(em);

      const promise = service.deleteCurrent(buildUser());

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CUSTOM_RANK_NOT_SET' },
      });
    });
  });
});
