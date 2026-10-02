/**
 * Unit tests for GroupFollowService - follow/unfollow idempotency (module:
 * "Akcje muszą być idempotentne lub bezpiecznie obsługiwać powtórzenie
 * requestu") and the bulk lookups CommunityOverviewService/
 * EventNotificationsService build on.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { GroupFollowBlock } from './entities/group-follow-block.entity';
import { GroupFollow } from './entities/group-follow.entity';
import { GroupFollowService } from './group-follow.service';

function buildEm(existing: GroupFollow | null) {
  const persist = jest
    .fn()
    .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) });
  const removeAndFlush = jest.fn().mockResolvedValue(undefined);
  const findOne = jest.fn().mockResolvedValue(existing);
  const find = jest.fn().mockResolvedValue([]);
  const count = jest.fn().mockResolvedValue(0);
  return {
    findOne,
    find,
    count,
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

  describe('follow - blocked', () => {
    it('rejects with GROUP_FOLLOW_BLOCKED while a GroupFollowBlock exists, writing nothing', async () => {
      const em = buildEm(null);
      (em as unknown as { count: jest.Mock }).count.mockResolvedValue(1);
      const service = new GroupFollowService(em);

      await expect(
        service.follow({ id: 'user-1' } as never, { id: 'group-1' } as never),
      ).rejects.toMatchObject({ response: { code: 'GROUP_FOLLOW_BLOCKED' } });
      expect(
        (em as unknown as { persist: jest.Mock }).persist,
      ).not.toHaveBeenCalled();
    });
  });

  describe('blockFollowing / removeFollower', () => {
    function buildTxEm(rows: {
      user: unknown;
      follow: unknown;
      block: unknown;
    }) {
      const remove = jest.fn();
      const persist = jest.fn();
      const flush = jest.fn().mockResolvedValue(undefined);
      const findOne = jest.fn((entity: { name: string }) => {
        if (entity === User) return Promise.resolve(rows.user);
        if (entity === GroupFollow) return Promise.resolve(rows.follow);
        if (entity === GroupFollowBlock) return Promise.resolve(rows.block);
        return Promise.resolve(null);
      });
      const tx = {
        findOne,
        remove,
        persist,
        flush,
        getReference: jest.fn((_entity: unknown, id: string) => ({ id })),
      };
      const em = {
        ...tx,
        removeAndFlush: jest.fn().mockResolvedValue(undefined),
        transactional: jest.fn((cb: (inner: typeof tx) => Promise<void>) =>
          cb(tx),
        ),
      } as unknown as EntityManager;
      return { em, remove, persist, flush };
    }

    it('blocking removes the current follow and records a block', async () => {
      const follow = { id: 'follow-1' };
      const { em, remove, persist } = buildTxEm({
        user: { id: 'user-1' },
        follow,
        block: null,
      });

      await new GroupFollowService(em).blockFollowing('group-1', 'user-1');

      expect(remove).toHaveBeenCalledWith(follow);
      expect(persist).toHaveBeenCalledWith(expect.any(GroupFollowBlock));
    });

    it('blocking is idempotent - an existing block is not duplicated', async () => {
      const { em, persist } = buildTxEm({
        user: { id: 'user-1' },
        follow: null,
        block: { id: 'block-1' },
      });

      await new GroupFollowService(em).blockFollowing('group-1', 'user-1');

      expect(persist).not.toHaveBeenCalled();
    });

    it('blocking an unknown user 404s with USER_NOT_FOUND', async () => {
      const { em } = buildTxEm({ user: null, follow: null, block: null });

      await expect(
        new GroupFollowService(em).blockFollowing('group-1', 'missing'),
      ).rejects.toMatchObject({ response: { code: 'USER_NOT_FOUND' } });
    });

    it('removeFollower without block only unfollows', async () => {
      const follow = { id: 'follow-1' };
      const { em } = buildTxEm({ user: null, follow, block: null });

      await new GroupFollowService(em).removeFollower(
        'group-1',
        'user-1',
        false,
      );

      expect(
        (em as unknown as { removeAndFlush: jest.Mock }).removeAndFlush,
      ).toHaveBeenCalledWith(follow);
      expect(
        (em as unknown as { transactional: jest.Mock }).transactional,
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
