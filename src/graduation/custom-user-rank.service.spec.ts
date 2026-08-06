import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Collection } from '@mikro-orm/core';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { User } from '../users/entities/user.entity';
import { CustomUserRankService } from './custom-user-rank.service';
import { CustomUserRank } from './entities/custom-user-rank.entity';
import { RankTrack } from './enums/rank-track.enum';

function buildUser(id = 'user-1'): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildCreateInput() {
  return {
    name: 'My own cordão',
    description: null,
    track: RankTrack.ADULT,
    cordSegments: [{ position: 1, colorHex: '#FF0000', proportion: 100 }],
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
  customRank.isActive = false;
  customRank.cordSegments = new Collection<never>(customRank);
  return Object.assign(customRank, overrides);
}

interface MockRouting {
  activeFormalGroup?: FormalGroupAffiliation | null;
  customRank?: CustomUserRank | null;
  currentlyActive?: CustomUserRank | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn(
    (entityClass: unknown, where: Record<string, unknown>) => {
      if (entityClass === FormalGroupAffiliation) {
        return Promise.resolve(
          routing.activeFormalGroup === undefined
            ? null
            : routing.activeFormalGroup,
        );
      }
      if (entityClass === CustomUserRank) {
        if (where && 'isActive' in where) {
          return Promise.resolve(
            routing.currentlyActive === undefined
              ? null
              : routing.currentlyActive,
          );
        }
        return Promise.resolve(
          routing.customRank === undefined ? null : routing.customRank,
        );
      }
      return Promise.resolve(null);
    },
  );

  const raw: Record<string, unknown> = { findOne, persist, flush, remove };
  raw.transactional = jest.fn((cb: (em: unknown) => unknown) => cb(raw));

  return { em: raw as unknown as EntityManager, persist, flush, remove };
}

describe('CustomUserRankService', () => {
  describe('create', () => {
    it('creates a custom cordão even while an active formal group is set - creation is always allowed', async () => {
      const { em, persist } = buildMockEm({
        activeFormalGroup: new FormalGroupAffiliation(),
      });
      const service = new CustomUserRankService(em);

      const result = await service.create(buildUser(), buildCreateInput());

      expect(persist).toHaveBeenCalled();
      expect(result.name).toBe('My own cordão');
      expect(result.isActive).toBe(false);
    });
  });

  describe('getById (IDOR)', () => {
    it('returns 404 for a custom cordão owned by another user, never leaking existence', async () => {
      const { em } = buildMockEm({ customRank: null });
      const service = new CustomUserRankService(em);

      const promise = service.getById(buildUser(), 'someone-elses-rank');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CUSTOM_RANK_NOT_FOUND' },
      });
    });

    it('returns the cordão when it exists and is owned by the caller', async () => {
      const { em } = buildMockEm({ customRank: buildCustomRank() });
      const service = new CustomUserRankService(em);

      const result = await service.getById(buildUser(), 'rank-1');
      expect(result.id).toBe('rank-1');
    });
  });

  describe('activate', () => {
    it('rejects activating while an active formal group is set', async () => {
      const { em } = buildMockEm({
        activeFormalGroup: new FormalGroupAffiliation(),
        customRank: buildCustomRank(),
      });
      const service = new CustomUserRankService(em);

      const promise = service.activate(buildUser(), 'rank-1');

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CUSTOM_RANK_REQUIRES_NO_FORMAL_GROUP' },
      });
    });

    it("returns 404 (IDOR-safe) for someone else's cordão, never confirming it exists", async () => {
      const { em } = buildMockEm({ activeFormalGroup: null, customRank: null });
      const service = new CustomUserRankService(em);

      const promise = service.activate(buildUser(), 'not-mine');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    });

    it('activates the target and deactivates whichever cordão was active before', async () => {
      const target = buildCustomRank({ id: 'rank-1', isActive: false });
      const previouslyActive = buildCustomRank({
        id: 'rank-2',
        isActive: true,
      });
      const { em } = buildMockEm({
        activeFormalGroup: null,
        customRank: target,
        currentlyActive: previouslyActive,
      });
      const service = new CustomUserRankService(em);

      const result = await service.activate(buildUser(), 'rank-1');

      expect(result.isActive).toBe(true);
      expect(previouslyActive.isActive).toBe(false);
    });

    it('is a no-op success when the target is already active', async () => {
      const target = buildCustomRank({ id: 'rank-1', isActive: true });
      const { em, flush } = buildMockEm({
        activeFormalGroup: null,
        customRank: target,
      });
      const service = new CustomUserRankService(em);

      const result = await service.activate(buildUser(), 'rank-1');

      expect(result.isActive).toBe(true);
      expect(flush).not.toHaveBeenCalled();
    });
  });

  describe('deactivate', () => {
    it('clears isActive for the owner', async () => {
      const target = buildCustomRank({ id: 'rank-1', isActive: true });
      const { em } = buildMockEm({ customRank: target });
      const service = new CustomUserRankService(em);

      const result = await service.deactivate(buildUser(), 'rank-1');
      expect(result.isActive).toBe(false);
    });
  });

  describe('delete', () => {
    it('always deletes for the owner - a custom cordão is never referenced by rank history', async () => {
      const customRank = buildCustomRank();
      const { em, remove } = buildMockEm({ customRank });
      const service = new CustomUserRankService(em);

      await service.delete(buildUser(), 'rank-1');
      expect(remove).toHaveBeenCalledWith(customRank);
    });

    it('returns 404 (IDOR-safe) when deleting a cordão owned by someone else', async () => {
      const { em } = buildMockEm({ customRank: null });
      const service = new CustomUserRankService(em);

      const promise = service.delete(buildUser(), 'not-mine');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
