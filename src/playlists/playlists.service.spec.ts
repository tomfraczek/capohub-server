import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Collection } from '@mikro-orm/core';
import { User } from '../users/entities/user.entity';
import { Playlist } from './entities/playlist.entity';
import { PlaylistSong } from './entities/playlist-song.entity';
import { PlaylistsService } from './playlists.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildPlaylist(overrides: Partial<Playlist> = {}): Playlist {
  const playlist = new Playlist();
  playlist.id = 'playlist-1';
  playlist.owner = buildUser();
  playlist.name = 'My playlist';
  playlist.description = null;
  playlist.songs = new Collection<PlaylistSong>(playlist, []);
  return Object.assign(playlist, overrides);
}

function buildPlaylistSong(
  overrides: Partial<PlaylistSong> = {},
): PlaylistSong {
  const playlistSong = new PlaylistSong();
  playlistSong.position = 1;
  return Object.assign(playlistSong, overrides);
}

function buildMockEm(overrides: Record<string, jest.Mock> = {}) {
  return {
    findOne: jest.fn().mockResolvedValue(null),
    find: jest.fn().mockResolvedValue([]),
    persist: jest
      .fn()
      .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) }),
    remove: jest
      .fn()
      .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) }),
    flush: jest.fn().mockResolvedValue(undefined),
    nativeDelete: jest.fn().mockResolvedValue(1),
    transactional: jest.fn(),
    getConnection: jest.fn().mockReturnValue({
      execute: jest.fn().mockResolvedValue([]),
    }),
    ...overrides,
  } as unknown as EntityManager;
}

describe('PlaylistsService', () => {
  describe('update / delete / removeSong / reorderSongs ownership', () => {
    it('update throws NotFoundException when the playlist does not belong to the caller', async () => {
      const em = buildMockEm({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new PlaylistsService(em);

      await expect(
        service.update('other-user', 'playlist-1', { name: 'x' }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('delete throws NotFoundException when the playlist does not belong to the caller', async () => {
      const em = buildMockEm({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new PlaylistsService(em);

      await expect(
        service.delete('other-user', 'playlist-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('getById throws NotFoundException when the playlist does not belong to the caller', async () => {
      const em = buildMockEm({ findOne: jest.fn().mockResolvedValue(null) });
      const service = new PlaylistsService(em);

      await expect(
        service.getById('other-user', 'playlist-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('create', () => {
    it('persists a new Playlist owned by the given user', async () => {
      const flush = jest.fn().mockResolvedValue(undefined);
      const persist = jest.fn().mockReturnValue({ flush });
      const playlist = buildPlaylist();
      const em = buildMockEm({
        persist,
        findOne: jest.fn().mockResolvedValue(playlist),
      });
      const service = new PlaylistsService(em);
      const user = buildUser();

      await service.create(user, { name: 'New playlist', description: null });

      expect(persist).toHaveBeenCalledWith(expect.any(Playlist));
      expect(flush).toHaveBeenCalled();
    });
  });

  describe('reorderSongs', () => {
    it('rejects when songIds is not exactly the current set of songs', async () => {
      const song1 = { id: 'song-1' };
      const rows = [buildPlaylistSong({ song: song1 as never, position: 1 })];
      const em = buildMockEm({
        findOne: jest.fn().mockResolvedValue(buildPlaylist()),
        find: jest.fn().mockResolvedValue(rows),
        transactional: jest
          .fn()
          .mockImplementation((cb: (em: EntityManager) => unknown) => cb(em)),
      });
      const service = new PlaylistsService(em);

      await expect(
        service.reorderSongs('user-1', 'playlist-1', ['song-2']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('rejects when songIds contains a duplicate', async () => {
      const song1 = { id: 'song-1' };
      const song2 = { id: 'song-2' };
      const rows = [
        buildPlaylistSong({ song: song1 as never, position: 1 }),
        buildPlaylistSong({ song: song2 as never, position: 2 }),
      ];
      const em = buildMockEm({
        findOne: jest.fn().mockResolvedValue(buildPlaylist()),
        find: jest.fn().mockResolvedValue(rows),
        transactional: jest
          .fn()
          .mockImplementation((cb: (em: EntityManager) => unknown) => cb(em)),
      });
      const service = new PlaylistsService(em);

      await expect(
        service.reorderSongs('user-1', 'playlist-1', ['song-1', 'song-1']),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it('reassigns positions in the requested order when the set matches exactly', async () => {
      const song1 = { id: 'song-1' };
      const song2 = { id: 'song-2' };
      const row1 = buildPlaylistSong({ song: song1 as never, position: 1 });
      const row2 = buildPlaylistSong({ song: song2 as never, position: 2 });
      const flush = jest.fn().mockResolvedValue(undefined);
      const em = buildMockEm({
        findOne: jest.fn().mockResolvedValue(buildPlaylist()),
        find: jest.fn().mockResolvedValue([row1, row2]),
        transactional: jest
          .fn()
          .mockImplementation((cb: (em: EntityManager) => unknown) => cb(em)),
        flush,
      });
      const service = new PlaylistsService(em);

      await service.reorderSongs('user-1', 'playlist-1', ['song-2', 'song-1']);

      expect(row2.position).toBe(1);
      expect(row1.position).toBe(2);
      expect(flush).toHaveBeenCalled();
    });
  });

  describe('addSong', () => {
    it('throws NotFoundException when the song does not exist', async () => {
      const em = buildMockEm({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(buildPlaylist()) // owned playlist lookup
          .mockResolvedValueOnce(null), // song lookup
        transactional: jest
          .fn()
          .mockImplementation((cb: (em: EntityManager) => unknown) => cb(em)),
      });
      const service = new PlaylistsService(em);

      await expect(
        service.addSong('user-1', 'playlist-1', 'missing-song'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('swallows a UniqueConstraintViolationException from a concurrent add', async () => {
      const playlist = buildPlaylist();
      const song = { id: 'song-1' };
      const flush = jest
        .fn()
        .mockRejectedValue(
          new UniqueConstraintViolationException(new Error('duplicate')),
        );
      const persist = jest.fn().mockReturnValue({ flush });
      const em = buildMockEm({
        findOne: jest
          .fn()
          .mockResolvedValueOnce(playlist)
          .mockResolvedValueOnce(song)
          .mockResolvedValueOnce(null) // existing PlaylistSong check -> none
          .mockResolvedValue(playlist), // getById's owned lookup afterwards
        persist,
        transactional: jest
          .fn()
          .mockImplementation((cb: (em: EntityManager) => unknown) => cb(em)),
      });
      const service = new PlaylistsService(em);

      await expect(
        service.addSong('user-1', 'playlist-1', 'song-1'),
      ).resolves.toBeDefined();
    });
  });
});
