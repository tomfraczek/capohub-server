import { NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { FavoriteSong } from './entities/favorite-song.entity';
import { FavoriteSongsService } from './favorite-songs.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildMockEm(overrides: Record<string, jest.Mock> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    count: jest.fn().mockResolvedValue(1),
    persist: jest
      .fn()
      .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) }),
    nativeDelete: jest.fn().mockResolvedValue(1),
    find: jest.fn().mockResolvedValue([]),
    getReference: jest
      .fn()
      .mockImplementation((_entity: unknown, id: string) => ({ id })),
    ...overrides,
  } as unknown as EntityManager;
}

describe('FavoriteSongsService', () => {
  describe('addFavorite', () => {
    it('throws NotFoundException when the song does not exist', async () => {
      const em = buildMockEm({ count: jest.fn().mockResolvedValue(0) });
      const service = new FavoriteSongsService(em);

      await expect(
        service.addFavorite(buildUser(), 'missing-song'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('is a no-op when the song is already favorited', async () => {
      const persist = jest.fn();
      const em = buildMockEm({
        findOne: jest.fn().mockResolvedValue(new FavoriteSong()),
        persist,
      });
      const service = new FavoriteSongsService(em);

      await service.addFavorite(buildUser(), 'song-1');

      expect(persist).not.toHaveBeenCalled();
    });

    it('persists a new FavoriteSong when none exists yet', async () => {
      const flush = jest.fn().mockResolvedValue(undefined);
      const persist = jest.fn().mockReturnValue({ flush });
      const em = buildMockEm({ persist });
      const service = new FavoriteSongsService(em);

      await service.addFavorite(buildUser(), 'song-1');

      expect(persist).toHaveBeenCalledWith(expect.any(FavoriteSong));
      expect(flush).toHaveBeenCalled();
    });

    it('swallows a UniqueConstraintViolationException from a concurrent favorite', async () => {
      const flush = jest
        .fn()
        .mockRejectedValue(
          new UniqueConstraintViolationException(new Error('duplicate')),
        );
      const persist = jest.fn().mockReturnValue({ flush });
      const em = buildMockEm({ persist });
      const service = new FavoriteSongsService(em);

      await expect(
        service.addFavorite(buildUser(), 'song-1'),
      ).resolves.toBeUndefined();
    });
  });

  describe('removeFavorite', () => {
    it('is idempotent - nativeDelete is called even when nothing existed', async () => {
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const em = buildMockEm({ nativeDelete });
      const service = new FavoriteSongsService(em);

      await service.removeFavorite('user-1', 'song-1');

      expect(nativeDelete).toHaveBeenCalledWith(FavoriteSong, {
        user: 'user-1',
        song: 'song-1',
      });
    });
  });

  describe('isFavorite', () => {
    it('returns true when a matching row exists', async () => {
      const em = buildMockEm({ count: jest.fn().mockResolvedValue(1) });
      const service = new FavoriteSongsService(em);

      await expect(service.isFavorite('user-1', 'song-1')).resolves.toBe(true);
    });

    it('returns false when no matching row exists', async () => {
      const em = buildMockEm({ count: jest.fn().mockResolvedValue(0) });
      const service = new FavoriteSongsService(em);

      await expect(service.isFavorite('user-1', 'song-1')).resolves.toBe(false);
    });
  });
});
