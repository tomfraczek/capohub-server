import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Event } from '../events/entities/event.entity';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { CareerTimelineEntriesService } from './career-timeline-entries.service';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import {
  CareerTimelineEntryType,
  CareerTimelinePrecision,
} from './enums/career-timeline-entry-type.enum';

function buildUser(id = 'user-1'): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildGroup(id = 'group-1', name = 'Cordao de Ouro'): Group {
  const group = new Group();
  group.id = id;
  group.name = name;
  return group;
}

function buildEvent(id = 'event-1'): Event {
  const event = new Event();
  event.id = id;
  event.name = 'Batizado 2024';
  event.startsAt = new Date('2024-01-01T10:00:00.000Z');
  event.locationName = 'Poznań';
  return event;
}

interface MockRouting {
  entry?: CareerTimelineEntry | null;
  group?: Group | null;
  section?: Section | null;
  event?: Event | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const remove = jest.fn().mockReturnValue({ flush });
  const persist = jest.fn().mockReturnValue({ flush });
  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === CareerTimelineEntry) {
      return Promise.resolve(
        routing.entry === undefined ? null : routing.entry,
      );
    }
    if (entityClass === Group) {
      return Promise.resolve(
        routing.group === undefined ? null : routing.group,
      );
    }
    if (entityClass === Section) {
      return Promise.resolve(
        routing.section === undefined ? null : routing.section,
      );
    }
    if (entityClass === Event) {
      return Promise.resolve(
        routing.event === undefined ? null : routing.event,
      );
    }
    return Promise.resolve(null);
  });
  return {
    em: { flush, remove, persist, findOne } as unknown as EntityManager,
    flush,
    remove,
    persist,
    findOne,
  };
}

function buildMockR2StorageService(): R2StorageService {
  return {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;
}

describe('CareerTimelineEntriesService', () => {
  describe('create - manual entry types', () => {
    it('creates a START_TRAINING entry with a server-generated title', async () => {
      const { em, persist } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.START_TRAINING,
        occurredOn: '2015-06-01',
        location: 'Poznań',
      });

      expect(persist).toHaveBeenCalled();
      expect(result).toMatchObject({
        type: CareerTimelineEntryType.START_TRAINING,
        origin: 'MANUAL',
        occurredOn: '2015-06-01',
        occurredOnPrecision: CareerTimelinePrecision.DAY,
        title: 'Rozpoczęcie treningów Capoeira',
        location: 'Poznań',
        editable: true,
      });
    });

    it('creates a BATIZADO entry linked to an existing CapoHub Event', async () => {
      const { em } = buildMockEm({ event: buildEvent() });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.BATIZADO,
        occurredOn: '2017-03-10',
        eventId: 'event-1',
      });

      expect(result.title).toBe('Batizado');
      expect(result.event).toMatchObject({ eventId: 'event-1' });
    });

    // Audit §3: the snapshot must capture the Event exactly as it looked at
    // link time - asserted here as "matches the Event fixture's current
    // values" (the only thing this unit test can directly observe); the
    // *drift-resistance* itself (snapshot stays put after the Event is
    // later edited) is covered at the aggregation-service level, in
    // "linked Event snapshot and visibility (audit §3)".
    it("snapshots the linked Event's name/date/location at creation time", async () => {
      const { em } = buildMockEm({ event: buildEvent() });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.BATIZADO,
        occurredOn: '2017-03-10',
        eventId: 'event-1',
      });

      expect(result.event).toMatchObject({
        title: 'Batizado 2024',
        locationName: 'Poznań',
        startsAt: '2024-01-01T10:00:00.000Z',
      });
    });

    it('creates a RECEIVED_APELIDO entry with the apelido embedded in the generated title', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.RECEIVED_APELIDO,
        occurredOn: '2018-01-01',
        apelido: 'Trovão',
        awardedByName: 'Mestre Sorriso',
      });

      expect(result.title).toBe('Otrzymanie apelido „Trovão”');
      expect(result.apelido).toBe('Trovão');
      expect(result.awardedByName).toBe('Mestre Sorriso');
    });

    it('creates a manual RECEIVED_RANK entry as free text, with no rankDetails/cord', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.RECEIVED_RANK,
        occurredOn: '2019-01-01',
        rankName: 'Instrutor',
      });

      expect(result.title).toBe('Otrzymanie stopnia Instrutor');
      expect(result.rankName).toBe('Instrutor');
      expect(result.rankDetails).toBeNull();
    });

    it('creates an OTHER entry with a fully user-provided title', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.OTHER,
        occurredOn: '2023-05-05',
        title: 'Wyjazd do Brazylii',
        description: 'Trzy tygodnie treningu w Salvadorze',
      });

      expect(result).toMatchObject({
        type: CareerTimelineEntryType.OTHER,
        title: 'Wyjazd do Brazylii',
        description: 'Trzy tygodnie treningu w Salvadorze',
      });
    });

    it('accepts a partial YEAR-precision date and normalizes it to Jan 1st', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.OTHER,
        occurredOn: '2012',
        title: 'Pierwszy rok treningów',
      });

      expect(result.occurredOn).toBe('2012-01-01');
      expect(result.occurredOnPrecision).toBe(CareerTimelinePrecision.YEAR);
    });

    it('resolves a linked Group by id and snapshots its current name', async () => {
      const { em } = buildMockEm({ group: buildGroup('group-1', 'Grupo Axé') });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.JOINED_GROUP,
        occurredOn: '2016-01-01',
        groupId: 'group-1',
      });

      expect(result.title).toBe('Dołączenie do Grupo Axé');
      expect(result.group).toEqual({ groupId: 'group-1', name: 'Grupo Axé' });
    });

    it('falls back to a free-text group name when no CapoHub Group is linked', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.create(buildUser(), {
        type: CareerTimelineEntryType.JOINED_GROUP,
        occurredOn: '2010-01-01',
        groupName: 'Grupo (sprzed CapoHub)',
      });

      expect(result.group).toEqual({
        groupId: null,
        name: 'Grupo (sprzed CapoHub)',
      });
    });

    it('rejects an unknown groupId with a 400', async () => {
      const { em } = buildMockEm({ group: null });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const promise = service.create(buildUser(), {
        type: CareerTimelineEntryType.JOINED_GROUP,
        occurredOn: '2016-01-01',
        groupId: 'nonexistent',
      });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CAREER_TIMELINE_ENTRY_GROUP_NOT_FOUND' },
      });
    });

    it('rejects an occurredOn in the future', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const futureDate = new Date(Date.now() + 30 * 86_400_000)
        .toISOString()
        .slice(0, 10);

      const promise = service.create(buildUser(), {
        type: CareerTimelineEntryType.OTHER,
        occurredOn: futureDate,
        title: 'Future event',
      });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CAREER_TIMELINE_ENTRY_OCCURRED_ON_IN_FUTURE' },
      });
    });

    it('rejects a future YEAR-precision date once the year itself is in the future', async () => {
      const { em } = buildMockEm();
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const nextYear = String(new Date().getUTCFullYear() + 1);

      const promise = service.create(buildUser(), {
        type: CareerTimelineEntryType.OTHER,
        occurredOn: nextYear,
        title: 'Next year',
      });

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getById / update / delete', () => {
    it('throws NOT_FOUND when the entry does not belong to the caller', async () => {
      const { em } = buildMockEm({ entry: null });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const promise = service.getById(buildUser(), 'other-users-entry');

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'CAREER_TIMELINE_ENTRY_NOT_FOUND' },
      });
    });

    it('throws NOT_FOUND for a SYSTEM item id - it is not a row this service owns', async () => {
      const { em } = buildMockEm({ entry: null });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const promise = service.update(
        buildUser(),
        'joined-group:affiliation-1',
        {
          type: CareerTimelineEntryType.OTHER,
          occurredOn: '2020-01-01',
          title: 'Attempted tamper',
        },
      );

      await expect(promise).rejects.toBeInstanceOf(NotFoundException);
    });

    it('updates a manual entry, regenerating its title and clearing stale type-specific fields', async () => {
      const entry = new CareerTimelineEntry();
      entry.id = 'entry-1';
      entry.type = CareerTimelineEntryType.OTHER;
      entry.occurredOn = new Date('2020-01-01');
      entry.title = 'Old title';
      entry.description = 'Old description';
      entry.apelido = 'StaleApelido';

      const { em } = buildMockEm({ entry });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      const result = await service.update(buildUser(), 'entry-1', {
        type: CareerTimelineEntryType.ACHIEVEMENT,
        occurredOn: '2021-06-15',
        title: 'New achievement',
        description: null,
      });

      expect(result).toMatchObject({
        type: CareerTimelineEntryType.ACHIEVEMENT,
        occurredOn: '2021-06-15',
        title: 'New achievement',
        description: null,
        apelido: null,
      });
    });

    it('removes the owned entry on delete', async () => {
      const entry = new CareerTimelineEntry();
      entry.id = 'entry-1';
      const { em, remove } = buildMockEm({ entry });
      const service = new CareerTimelineEntriesService(
        em,
        buildMockR2StorageService(),
      );

      await service.delete(buildUser(), 'entry-1');

      expect(remove).toHaveBeenCalledWith(entry);
    });
  });
});
