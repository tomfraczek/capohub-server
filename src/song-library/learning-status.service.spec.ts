import { NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { UserSongLearning } from './entities/user-song-learning.entity';
import { LearningStatus } from './enums/learning-status.enum';
import { LearningStatusService } from './learning-status.service';

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
    find: jest.fn().mockResolvedValue([]),
    getReference: jest
      .fn()
      .mockImplementation((_entity: unknown, id: string) => ({ id })),
    ...overrides,
  } as unknown as EntityManager;
}

describe('LearningStatusService', () => {
  describe('setStatus', () => {
    it('throws NotFoundException when the song does not exist', async () => {
      const em = buildMockEm({ count: jest.fn().mockResolvedValue(0) });
      const service = new LearningStatusService(em);

      await expect(
        service.setStatus(buildUser(), 'missing-song', LearningStatus.LEARNING),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('creates a new row when none exists yet', async () => {
      const flush = jest.fn().mockResolvedValue(undefined);
      const persist = jest.fn().mockReturnValue({ flush });
      const em = buildMockEm({ persist });
      const service = new LearningStatusService(em);

      const status = await service.setStatus(
        buildUser(),
        'song-1',
        LearningStatus.MASTERED,
      );

      expect(persist).toHaveBeenCalledWith(expect.any(UserSongLearning));
      expect(status).toBe(LearningStatus.MASTERED);
    });

    it('updates the existing row in place, without persisting a new one', async () => {
      const existing = new UserSongLearning();
      existing.status = LearningStatus.NOT_STARTED;
      const persist = jest.fn();
      const flush = jest.fn().mockResolvedValue(undefined);
      const em = buildMockEm({
        findOne: jest.fn().mockResolvedValue(existing),
        persist,
        flush,
      });
      const service = new LearningStatusService(em);

      const status = await service.setStatus(
        buildUser(),
        'song-1',
        LearningStatus.CAN_LEAD,
      );

      expect(persist).not.toHaveBeenCalled();
      expect(flush).toHaveBeenCalled();
      expect(status).toBe(LearningStatus.CAN_LEAD);
      expect(existing.status).toBe(LearningStatus.CAN_LEAD);
    });

    it('recovers from a concurrent insert by updating the winning row', async () => {
      const raceRecord = new UserSongLearning();
      raceRecord.status = LearningStatus.NOT_STARTED;
      const flush = jest.fn().mockResolvedValue(undefined);
      const persist = jest.fn().mockReturnValue({
        flush: jest
          .fn()
          .mockRejectedValue(
            new UniqueConstraintViolationException(new Error('duplicate')),
          ),
      });
      const em = buildMockEm({
        persist,
        findOneOrFail: jest.fn().mockResolvedValue(raceRecord),
        flush,
      });
      const service = new LearningStatusService(em);

      const status = await service.setStatus(
        buildUser(),
        'song-1',
        LearningStatus.TO_REVIEW,
      );

      expect(status).toBe(LearningStatus.TO_REVIEW);
      expect(raceRecord.status).toBe(LearningStatus.TO_REVIEW);
    });
  });

  describe('removeStatus', () => {
    it('is idempotent', async () => {
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const em = buildMockEm({ nativeDelete });
      const service = new LearningStatusService(em);

      await service.removeStatus('user-1', 'song-1');

      expect(nativeDelete).toHaveBeenCalledWith(UserSongLearning, {
        user: 'user-1',
        song: 'song-1',
      });
    });
  });

  describe('getStatus', () => {
    it('returns null when no row exists', async () => {
      const em = buildMockEm();
      const service = new LearningStatusService(em);

      await expect(service.getStatus('user-1', 'song-1')).resolves.toBeNull();
    });

    it('returns the tracked status when a row exists', async () => {
      const record = new UserSongLearning();
      record.status = LearningStatus.LEARNING;
      const em = buildMockEm({ findOne: jest.fn().mockResolvedValue(record) });
      const service = new LearningStatusService(em);

      await expect(service.getStatus('user-1', 'song-1')).resolves.toBe(
        LearningStatus.LEARNING,
      );
    });
  });
});
