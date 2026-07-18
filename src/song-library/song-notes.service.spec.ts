import { NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { SongNote } from './entities/song-note.entity';
import { SongNotesService } from './song-notes.service';

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
    findOneOrFail: jest.fn(),
    count: jest.fn().mockResolvedValue(1),
    persist: jest
      .fn()
      .mockReturnValue({ flush: jest.fn().mockResolvedValue(undefined) }),
    flush: jest.fn().mockResolvedValue(undefined),
    nativeDelete: jest.fn().mockResolvedValue(1),
    getReference: jest
      .fn()
      .mockImplementation((_entity: unknown, id: string) => ({ id })),
    ...overrides,
  } as unknown as EntityManager;
}

describe('SongNotesService', () => {
  describe('upsertNote', () => {
    it('throws NotFoundException when the song does not exist', async () => {
      const em = buildMockEm({ count: jest.fn().mockResolvedValue(0) });
      const service = new SongNotesService(em);

      await expect(
        service.upsertNote(buildUser(), 'missing-song', 'hello'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a new note when none exists yet', async () => {
      const flush = jest.fn().mockResolvedValue(undefined);
      const persist = jest.fn().mockReturnValue({ flush });
      const em = buildMockEm({ persist });
      const service = new SongNotesService(em);

      const note = await service.upsertNote(buildUser(), 'song-1', 'hello');

      expect(persist).toHaveBeenCalledWith(expect.any(SongNote));
      expect(note.content).toBe('hello');
    });

    it('updates the existing note in place, without persisting a new one', async () => {
      const existing = new SongNote();
      existing.content = 'old content';
      const persist = jest.fn();
      const flush = jest.fn().mockResolvedValue(undefined);
      const em = buildMockEm({
        findOne: jest.fn().mockResolvedValue(existing),
        persist,
        flush,
      });
      const service = new SongNotesService(em);

      const note = await service.upsertNote(buildUser(), 'song-1', 'updated');

      expect(persist).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalled();
      expect(note.content).toBe('updated');
    });

    it('recovers from a concurrent insert by updating the winning row', async () => {
      const raceNote = new SongNote();
      raceNote.content = 'race-created';
      const persist = jest.fn().mockReturnValue({
        flush: jest
          .fn()
          .mockRejectedValue(
            new UniqueConstraintViolationException(new Error('duplicate')),
          ),
      });
      const flush = jest.fn().mockResolvedValue(undefined);
      const em = buildMockEm({
        persist,
        findOneOrFail: jest.fn().mockResolvedValue(raceNote),
        flush,
      });
      const service = new SongNotesService(em);

      const note = await service.upsertNote(buildUser(), 'song-1', 'final');

      expect(note.content).toBe('final');
      expect(raceNote.content).toBe('final');
    });
  });

  describe('removeNote', () => {
    it('is idempotent', async () => {
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const em = buildMockEm({ nativeDelete });
      const service = new SongNotesService(em);

      await service.removeNote('user-1', 'song-1');

      expect(nativeDelete).toHaveBeenCalledWith(SongNote, {
        user: 'user-1',
        song: 'song-1',
      });
    });
  });

  describe('getNote', () => {
    it('returns null when no note exists', async () => {
      const em = buildMockEm();
      const service = new SongNotesService(em);

      await expect(service.getNote('user-1', 'song-1')).resolves.toBeNull();
    });
  });
});
