import { User } from '../users/entities/user.entity';
import { PlaylistsController } from './playlists.controller';
import { PlaylistsService } from './playlists.service';

function buildUser(): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return user;
}

describe('PlaylistsController', () => {
  describe('list', () => {
    it('delegates to PlaylistsService.list with the current user id', async () => {
      const list = jest.fn().mockResolvedValue([]);
      const controller = new PlaylistsController({
        list,
      } as unknown as PlaylistsService);
      const user = buildUser();

      const response = await controller.list(user);

      expect(list).toHaveBeenCalledWith('user-1');
      expect(response).toEqual([]);
    });
  });

  describe('create', () => {
    it('delegates to PlaylistsService.create with the user and body', async () => {
      const dto = { id: 'playlist-1' };
      const create = jest.fn().mockResolvedValue(dto);
      const controller = new PlaylistsController({
        create,
      } as unknown as PlaylistsService);
      const user = buildUser();
      const body = { name: 'New playlist', description: null };

      const response = await controller.create(user, body);

      expect(create).toHaveBeenCalledWith(user, body);
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to PlaylistsService.getById with the current user id and playlist id', async () => {
      const dto = { id: 'playlist-1' };
      const getById = jest.fn().mockResolvedValue(dto);
      const controller = new PlaylistsController({
        getById,
      } as unknown as PlaylistsService);
      const user = buildUser();

      const response = await controller.getById('playlist-1', user);

      expect(getById).toHaveBeenCalledWith('user-1', 'playlist-1');
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to PlaylistsService.update', async () => {
      const dto = { id: 'playlist-1' };
      const update = jest.fn().mockResolvedValue(dto);
      const controller = new PlaylistsController({
        update,
      } as unknown as PlaylistsService);
      const user = buildUser();
      const body = { name: 'Renamed' };

      const response = await controller.update('playlist-1', user, body);

      expect(update).toHaveBeenCalledWith('user-1', 'playlist-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('delete', () => {
    it('delegates to PlaylistsService.delete', async () => {
      const del = jest.fn().mockResolvedValue(undefined);
      const controller = new PlaylistsController({
        delete: del,
      } as unknown as PlaylistsService);
      const user = buildUser();

      await controller.delete('playlist-1', user);

      expect(del).toHaveBeenCalledWith('user-1', 'playlist-1');
    });
  });

  describe('addSong', () => {
    it('delegates to PlaylistsService.addSong with the body songId', async () => {
      const dto = { id: 'playlist-1' };
      const addSong = jest.fn().mockResolvedValue(dto);
      const controller = new PlaylistsController({
        addSong,
      } as unknown as PlaylistsService);
      const user = buildUser();

      const response = await controller.addSong('playlist-1', user, {
        songId: 'song-1',
      });

      expect(addSong).toHaveBeenCalledWith('user-1', 'playlist-1', 'song-1');
      expect(response).toBe(dto);
    });
  });

  describe('removeSong', () => {
    it('delegates to PlaylistsService.removeSong', async () => {
      const dto = { id: 'playlist-1' };
      const removeSong = jest.fn().mockResolvedValue(dto);
      const controller = new PlaylistsController({
        removeSong,
      } as unknown as PlaylistsService);
      const user = buildUser();

      const response = await controller.removeSong(
        'playlist-1',
        'song-1',
        user,
      );

      expect(removeSong).toHaveBeenCalledWith('user-1', 'playlist-1', 'song-1');
      expect(response).toBe(dto);
    });
  });

  describe('reorderSongs', () => {
    it('delegates to PlaylistsService.reorderSongs with the body songIds', async () => {
      const dto = { id: 'playlist-1' };
      const reorderSongs = jest.fn().mockResolvedValue(dto);
      const controller = new PlaylistsController({
        reorderSongs,
      } as unknown as PlaylistsService);
      const user = buildUser();

      const response = await controller.reorderSongs('playlist-1', user, {
        songIds: ['song-2', 'song-1'],
      });

      expect(reorderSongs).toHaveBeenCalledWith('user-1', 'playlist-1', [
        'song-2',
        'song-1',
      ]);
      expect(response).toBe(dto);
    });
  });
});
