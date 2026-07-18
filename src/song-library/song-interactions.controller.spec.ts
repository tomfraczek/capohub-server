import { User } from '../users/entities/user.entity';
import { LearningStatus } from './enums/learning-status.enum';
import { FavoriteSongsService } from './favorite-songs.service';
import { LearningStatusService } from './learning-status.service';
import { SongNote } from './entities/song-note.entity';
import { SongInteractionsController } from './song-interactions.controller';
import { SongNotesService } from './song-notes.service';

function buildUser(): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return user;
}

function buildController(
  overrides: {
    favoriteSongsService?: Partial<FavoriteSongsService>;
    learningStatusService?: Partial<LearningStatusService>;
    songNotesService?: Partial<SongNotesService>;
  } = {},
): SongInteractionsController {
  return new SongInteractionsController(
    (overrides.favoriteSongsService ?? {}) as FavoriteSongsService,
    (overrides.learningStatusService ?? {}) as LearningStatusService,
    (overrides.songNotesService ?? {}) as SongNotesService,
  );
}

describe('SongInteractionsController', () => {
  describe('addFavorite', () => {
    it('delegates to FavoriteSongsService.addFavorite and returns isFavorite: true', async () => {
      const addFavorite = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({
        favoriteSongsService: { addFavorite },
      });
      const user = buildUser();

      const response = await controller.addFavorite('song-1', user);

      expect(addFavorite).toHaveBeenCalledWith(user, 'song-1');
      expect(response).toEqual({ songId: 'song-1', isFavorite: true });
    });
  });

  describe('removeFavorite', () => {
    it('delegates to FavoriteSongsService.removeFavorite', async () => {
      const removeFavorite = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({
        favoriteSongsService: { removeFavorite },
      });
      const user = buildUser();

      await controller.removeFavorite('song-1', user);

      expect(removeFavorite).toHaveBeenCalledWith('user-1', 'song-1');
    });
  });

  describe('setLearningStatus', () => {
    it('delegates to LearningStatusService.setStatus and returns the resulting status', async () => {
      const setStatus = jest.fn().mockResolvedValue(LearningStatus.MASTERED);
      const controller = buildController({
        learningStatusService: { setStatus },
      });
      const user = buildUser();

      const response = await controller.setLearningStatus('song-1', user, {
        status: LearningStatus.MASTERED,
      });

      expect(setStatus).toHaveBeenCalledWith(
        user,
        'song-1',
        LearningStatus.MASTERED,
      );
      expect(response).toEqual({
        songId: 'song-1',
        status: LearningStatus.MASTERED,
      });
    });
  });

  describe('removeLearningStatus', () => {
    it('delegates to LearningStatusService.removeStatus', async () => {
      const removeStatus = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({
        learningStatusService: { removeStatus },
      });
      const user = buildUser();

      await controller.removeLearningStatus('song-1', user);

      expect(removeStatus).toHaveBeenCalledWith('user-1', 'song-1');
    });
  });

  describe('getMyNote', () => {
    it('returns null content when no note exists', async () => {
      const getNote = jest.fn().mockResolvedValue(null);
      const controller = buildController({ songNotesService: { getNote } });
      const user = buildUser();

      const response = await controller.getMyNote('song-1', user);

      expect(getNote).toHaveBeenCalledWith('user-1', 'song-1');
      expect(response).toEqual({
        songId: 'song-1',
        content: null,
        updatedAt: null,
      });
    });

    it('returns the note content and updatedAt when a note exists', async () => {
      const note = new SongNote();
      note.content = 'My private note';
      note.updatedAt = new Date('2026-01-01T00:00:00.000Z');
      const getNote = jest.fn().mockResolvedValue(note);
      const controller = buildController({ songNotesService: { getNote } });

      const response = await controller.getMyNote('song-1', buildUser());

      expect(response).toEqual({
        songId: 'song-1',
        content: 'My private note',
        updatedAt: '2026-01-01T00:00:00.000Z',
      });
    });
  });

  describe('setMyNote', () => {
    it('delegates to SongNotesService.upsertNote and returns the note', async () => {
      const note = new SongNote();
      note.content = 'Updated note';
      note.updatedAt = new Date('2026-01-02T00:00:00.000Z');
      const upsertNote = jest.fn().mockResolvedValue(note);
      const controller = buildController({
        songNotesService: { upsertNote },
      });
      const user = buildUser();

      const response = await controller.setMyNote('song-1', user, {
        content: 'Updated note',
      });

      expect(upsertNote).toHaveBeenCalledWith(user, 'song-1', 'Updated note');
      expect(response).toEqual({
        songId: 'song-1',
        content: 'Updated note',
        updatedAt: '2026-01-02T00:00:00.000Z',
      });
    });
  });

  describe('removeMyNote', () => {
    it('delegates to SongNotesService.removeNote', async () => {
      const removeNote = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({
        songNotesService: { removeNote },
      });
      const user = buildUser();

      await controller.removeMyNote('song-1', user);

      expect(removeNote).toHaveBeenCalledWith('user-1', 'song-1');
    });
  });
});
