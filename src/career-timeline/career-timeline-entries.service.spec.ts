import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CareerTimelineEntriesService } from './career-timeline-entries.service';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import { CareerTimelineCategory } from './enums/career-timeline-category.enum';

function buildUser(id = 'user-1'): User {
  const user = new User();
  user.id = id;
  return user;
}

interface MockRouting {
  entry?: CareerTimelineEntry | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockReturnValue({ flush });
  const persist = jest.fn().mockReturnValue({ flush });
  const findOne = jest.fn(() =>
    Promise.resolve(routing.entry === undefined ? null : routing.entry),
  );
  return {
    em: { flush, remove, persist, findOne } as unknown as EntityManager,
    flush,
    remove,
    persist,
    findOne,
  };
}

describe('CareerTimelineEntriesService', () => {
  describe('create', () => {
    it('creates a CUSTOM item with today or an earlier occurredOn', async () => {
      const { em, persist } = buildMockEm();
      const service = new CareerTimelineEntriesService(em);

      const result = await service.create(buildUser(), {
        occurredOn: '2020-01-01',
        title: 'First roda',
        description: 'My first roda ever',
      });

      expect(persist).toHaveBeenCalled();
      expect(result).toMatchObject({
        category: CareerTimelineCategory.CUSTOM,
        occurredOn: '2020-01-01',
        title: 'First roda',
        description: 'My first roda ever',
      });
    });

    it('rejects an occurredOn in the future', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(em);

      const futureDate = new Date(Date.now() + 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const promise = service.create(buildUser(), {
        occurredOn: futureDate,
        title: 'Future event',
        description: null,
      });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CAREER_TIMELINE_ENTRY_OCCURRED_ON_IN_FUTURE' },
      });
    });
  });

  describe('getById / update / delete', () => {
    it('throws NOT_FOUND when the entry does not belong to the caller', async () => {
      const { em } = buildMockEm({ entry: null });
      const service = new CareerTimelineEntriesService(em);

      const promise = service.getById(buildUser(), 'other-users-entry');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CAREER_TIMELINE_ENTRY_NOT_FOUND' },
      });
    });

    it('updates every field on the owned entry', async () => {
      const entry = new CareerTimelineEntry();
      entry.id = 'entry-1';
      entry.occurredOn = new Date('2020-01-01');
      entry.title = 'Old title';
      entry.description = 'Old description';

      const { em } = buildMockEm({ entry });
      const service = new CareerTimelineEntriesService(em);

      const result = await service.update(buildUser(), 'entry-1', {
        occurredOn: '2021-06-15',
        title: 'New title',
        description: null,
      });

      expect(result).toMatchObject({
        occurredOn: '2021-06-15',
        title: 'New title',
        description: null,
      });
    });

    it('removes the owned entry on delete', async () => {
      const entry = new CareerTimelineEntry();
      entry.id = 'entry-1';
      const { em, remove } = buildMockEm({ entry });
      const service = new CareerTimelineEntriesService(em);

      await service.delete(buildUser(), 'entry-1');

      expect(remove).toHaveBeenCalledWith(entry);
    });
  });
});
