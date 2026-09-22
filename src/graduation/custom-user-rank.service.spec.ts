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

  const raw: Record<string, unknown> = { findOne, persist, flush, remove };
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
            'duplicate key value violates unique constraint "custom_user_ranks_user_id_unique"',
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

    it('updates the existing row in place and fully replaces cordSegments, rather than creating a second row', async () => {
      const existing = buildCustomRank({
        name: 'Old name',
        track: RankTrack.CHILD,
      });
      const { em, remove } = buildMockEm({ customRank: existing });
      const service = new CustomUserRankService(em);

      const result = await service.setCurrent(
        buildUser(),
        buildInput({
          name: 'New name',
          track: RankTrack.ADULT,
          cordSegments: [{ position: 1, colorHex: '#00FF00', proportion: 100 }],
        }),
      );

      expect(result.id).toBe('rank-1');
      expect(result.name).toBe('New name');
      expect(result.track).toBe(RankTrack.ADULT);
      expect(result.cordSegments).toEqual([
        { position: 1, colorHex: '#00FF00', proportion: 100 },
      ]);
      expect(remove).not.toHaveBeenCalledWith(existing);
    });
  });

  describe('deleteCurrent', () => {
    it('deletes the caller row', async () => {
      const customRank = buildCustomRank();
      const { em, remove } = buildMockEm({ customRank });
      const service = new CustomUserRankService(em);

      await service.deleteCurrent(buildUser());
      expect(remove).toHaveBeenCalledWith(customRank);
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
