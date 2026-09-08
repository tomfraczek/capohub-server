/**
 * Unit tests for GroupFollowService - follow/unfollow idempotency (module:
 * "Akcje muszą być idempotentne lub bezpiecznie obsługiwać powtórzenie
 * requestu") and the bulk lookups CommunityOverviewService/
 * EventNotificationsService build on.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { GroupFollow } from './entities/group-follow.entity';
import { GroupFollowService } from './group-follow.service';

function buildEm(existing: GroupFollow | null) {
  const persist = jest
    .fn()
    .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) });
  const removeAndFlush = jest.fn().mockResolvedValue(undefined);
  const findOne = jest.fn().mockResolvedValue(existing);
  const find = jest.fn().mockResolvedValue([]);
  return {
    findOne,
    find,
    persist,
    removeAndFlush,
  } as unknown as EntityManager;
}

describe('GroupFollowService', () => {
  describe('follow', () => {
    it('creates a GroupFollow row when none exists yet', async () => {
      const em = buildEm(null);
      const service = new GroupFollowService(em);
      const user = { id: 'user-1' } as never;
      const group = { id: 'group-1' } as never;

      await service.follow(user, group);

      expect(
        (em as unknown as { persist: jest.Mock }).persist,
      ).toHaveBeenCalled();
    });

    it('is idempotent - following an already-followed Group writes nothing new', async () => {
      const existing = Object.assign(new GroupFollow(), { id: 'follow-1' });
      const em = buildEm(existing);
      const service = new GroupFollowService(em);
      const user = { id: 'user-1' } as never;
      const group = { id: 'group-1' } as never;

      await service.follow(user, group);

      expect(
        (em as unknown as { persist: jest.Mock }).persist,
      ).not.toHaveBeenCalled();
    });
  });

  describe('unfollow', () => {
    it('removes an existing GroupFollow row', async () => {
      const existing = Object.assign(new GroupFollow(), { id: 'follow-1' });
      const em = buildEm(existing);
      const service = new GroupFollowService(em);

      await service.unfollow('user-1', 'group-1');

      expect(
        (em as unknown as { removeAndFlush: jest.Mock }).removeAndFlush,
      ).toHaveBeenCalledWith(existing);
    });

    it('is idempotent - unfollowing an already-not-followed Group is a no-op', async () => {
      const em = buildEm(null);
      const service = new GroupFollowService(em);

      await service.unfollow('user-1', 'group-1');

      expect(
        (em as unknown as { removeAndFlush: jest.Mock }).removeAndFlush,
      ).not.toHaveBeenCalled();
    });
  });

  describe('isFollowing', () => {
    it('returns true when a GroupFollow row exists, false otherwise', async () => {
      const followingEm = buildEm(
        Object.assign(new GroupFollow(), { id: 'f1' }),
      );
      const notFollowingEm = buildEm(null);

      expect(
        await new GroupFollowService(followingEm).isFollowing(
          'user-1',
          'group-1',
        ),
      ).toBe(true);
      expect(
        await new GroupFollowService(notFollowingEm).isFollowing(
          'user-1',
          'group-1',
        ),
      ).toBe(false);
    });
  });
});
