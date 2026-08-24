import { Collection } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from '../events/event-access.service';
import { Event } from '../events/entities/event.entity';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import { EventStatus } from '../events/enums/event-status.enum';
import { EventType } from '../events/enums/event-type.enum';
import { EventVisibility } from '../events/enums/event-visibility.enum';
import { EventRsvpStatus } from '../events/enums/event-rsvp-status.enum';
import { EventAttendeeSubjectType } from '../events/enums/event-attendee-subject-type.enum';
import { FormalRankCorrectionService } from '../graduation/formal-rank-correction.service';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { Rank } from '../graduation/entities/rank.entity';
import { RankTrack } from '../graduation/enums/rank-track.enum';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { Group } from '../groups/entities/group.entity';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { CareerTimelineAggregationService } from './career-timeline-aggregation.service';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import { CareerTimelineCategory } from './enums/career-timeline-category.enum';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'ada@example.com';
  user.capoeiraStartedAt = null;
  user.showCapoeiraStartedAt = false;
  user.showFormalGroup = false;
  user.showFormalRank = false;
  user.showCareerTimeline = false;
  user.showEventParticipation = false;
  Object.assign(user, overrides);
  return user;
}

function buildGroup(id = 'group-1', name = 'Cordao de Ouro'): Group {
  const group = new Group();
  group.id = id;
  group.name = name;
  return group;
}

function buildRank(overrides: Partial<Rank> = {}): Rank {
  const rank = new Rank();
  rank.id = 'rank-1';
  rank.name = 'Corda Verde';
  rank.track = RankTrack.ADULT;
  rank.cordSegments = new Collection<never>(rank);
  return Object.assign(rank, overrides);
}

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.name = 'Batizado 2024';
  event.type = EventType.FESTIVAL;
  event.startsAt = new Date('2024-01-01T10:00:00.000Z');
  event.endsAt = new Date('2024-01-01T18:00:00.000Z');
  event.status = EventStatus.FINISHED;
  event.visibility = EventVisibility.PUBLIC;
  event.communityGroup = buildGroup();
  event.communitySection = null;
  return Object.assign(event, overrides);
}

interface MockRouting {
  user?: User | null;
  affiliations?: FormalGroupAffiliation[];
  assignments?: FormalRankAssignment[];
  attendees?: EventAttendee[];
  entries?: CareerTimelineEntry[];
}

function buildMockEm(routing: MockRouting = {}) {
  const find = jest.fn((entityClass: unknown) => {
    if (entityClass === FormalGroupAffiliation) {
      return Promise.resolve(routing.affiliations ?? []);
    }
    if (entityClass === FormalRankAssignment) {
      return Promise.resolve(routing.assignments ?? []);
    }
    if (entityClass === EventAttendee) {
      return Promise.resolve(routing.attendees ?? []);
    }
    if (entityClass === CareerTimelineEntry) {
      return Promise.resolve(routing.entries ?? []);
    }
    return Promise.resolve([]);
  });
  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === User) {
      return Promise.resolve(routing.user === undefined ? null : routing.user);
    }
    return Promise.resolve(null);
  });
  return { find, findOne } as unknown as EntityManager;
}

function buildMockCorrectionService(
  isPubliclyVisible: (id: string) => Promise<boolean> = () =>
    Promise.resolve(true),
): { service: FormalRankCorrectionService; isPubliclyVisible: jest.Mock } {
  const mock = jest.fn(isPubliclyVisible);
  return {
    service: {
      isPubliclyVisible: mock,
    } as unknown as FormalRankCorrectionService,
    isPubliclyVisible: mock,
  };
}

function buildMockEventAccessService(
  isVisibleToViewer: () => Promise<boolean> = () => Promise.resolve(true),
): EventAccessService {
  return {
    isVisibleToViewer: jest.fn(isVisibleToViewer),
  } as unknown as EventAccessService;
}

// Deterministic fake - none of the fixtures below give their Event a
// communityGroup/communitySection with a profileImageKey set, so
// buildPublicUrl is never actually invoked; it only needs to satisfy
// buildEventItem's PublicUrlBuilder shape (see event-organizer-ref.mapper's
// own spec for dedicated key-priority coverage).
function buildMockR2StorageService(): R2StorageService {
  return {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;
}

describe('CareerTimelineAggregationService', () => {
  describe('CAPOEIRA_START', () => {
    it('includes an entry for the owner when capoeiraStartedAt is set', async () => {
      const user = buildUser({ capoeiraStartedAt: new Date('2015-06-01') });
      const em = buildMockEm();
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toMatchObject({
        id: 'capoeira-start:user-1',
        category: CareerTimelineCategory.CAPOEIRA_START,
        occurredOn: '2015-06-01',
      });
    });

    it('omits the entry entirely when capoeiraStartedAt is null', async () => {
      const user = buildUser({ capoeiraStartedAt: null });
      const em = buildMockEm();
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('privacy gating for non-owner viewers', () => {
    it('returns an empty timeline when the target has showCareerTimeline=false', async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: false,
        capoeiraStartedAt: new Date('2015-06-01'),
        showCapoeiraStartedAt: true,
      });
      const em = buildMockEm({ user: target });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(result).toEqual({ items: [], total: 0, hasMore: false });
    });

    it('hides FORMAL_GROUP_JOINED when showFormalGroup is false, even though showCareerTimeline is true', async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: true,
        showFormalGroup: false,
      });
      const affiliation = new FormalGroupAffiliation();
      affiliation.id = 'affiliation-1';
      affiliation.group = buildGroup();
      affiliation.startedOn = new Date('2020-01-01');
      const em = buildMockEm({ user: target, affiliations: [affiliation] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('FORMAL_RANK correction visibility', () => {
    function buildAssignment(): FormalRankAssignment {
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank();
      assignment.sourceGroup = buildGroup();
      assignment.startedOn = new Date('2022-01-01');
      assignment.event = null;
      return assignment;
    }

    it('hides a FORMAL_RANK entry from a non-owner while a correction is active', async () => {
      const viewer = buildUser({ id: 'viewer-1' });
      const target = buildUser({
        id: 'target-1',
        showCareerTimeline: true,
        showFormalRank: true,
      });
      const em = buildMockEm({
        user: target,
        assignments: [buildAssignment()],
      });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService(() => Promise.resolve(false)).service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(viewer, target.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });

    it('always shows the FORMAL_RANK entry to the owner, regardless of an active correction', async () => {
      const user = buildUser({ showFormalRank: true });
      const em = buildMockEm({ assignments: [buildAssignment()] });
      const { service: correctionService, isPubliclyVisible } =
        buildMockCorrectionService(() => Promise.resolve(false));
      const service = new CareerTimelineAggregationService(
        em,
        correctionService,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(isPubliclyVisible).not.toHaveBeenCalled();
    });
  });

  describe('EVENT / FORMAL_RANK dedup', () => {
    it('does not return a duplicate EVENT entry for an Event already linked via FormalRankAssignment.event', async () => {
      const user = buildUser({ showFormalRank: true });
      const event = buildEvent();
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank();
      assignment.sourceGroup = buildGroup();
      assignment.startedOn = new Date('2024-01-01');
      assignment.event = event;

      const attendee = new EventAttendee();
      attendee.id = 'attendee-1';
      attendee.event = event;
      attendee.subjectType = EventAttendeeSubjectType.SELF;
      attendee.subjectUser = user;
      attendee.rsvpStatus = EventRsvpStatus.GOING;

      const em = buildMockEm({
        assignments: [assignment],
        attendees: [attendee],
      });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      const categories = result.items.map((item) => item.category);
      expect(categories).toEqual([CareerTimelineCategory.FORMAL_RANK]);
    });

    it('still returns the EVENT entry when FORMAL_RANK is excluded from the requested categories', async () => {
      const user = buildUser({ showFormalRank: true });
      const event = buildEvent();
      const assignment = new FormalRankAssignment();
      assignment.id = 'assignment-1';
      assignment.rank = buildRank();
      assignment.sourceGroup = buildGroup();
      assignment.startedOn = new Date('2024-01-01');
      assignment.event = event;

      const attendee = new EventAttendee();
      attendee.id = 'attendee-1';
      attendee.event = event;
      attendee.subjectType = EventAttendeeSubjectType.SELF;
      attendee.subjectUser = user;
      attendee.rsvpStatus = EventRsvpStatus.GOING;

      const em = buildMockEm({
        assignments: [assignment],
        attendees: [attendee],
      });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        categories: [CareerTimelineCategory.EVENT],
        limit: 20,
        offset: 0,
      });

      const categories = result.items.map((item) => item.category);
      expect(categories).toEqual([CareerTimelineCategory.EVENT]);
    });

    it('excludes a future or cancelled Event from the EVENT category', async () => {
      const user = buildUser();
      const futureEvent = buildEvent({
        id: 'event-future',
        startsAt: new Date(Date.now() + 86_400_000),
      });
      const cancelledEvent = buildEvent({
        id: 'event-cancelled',
        status: EventStatus.CANCELLED,
      });

      const attendeeFuture = new EventAttendee();
      attendeeFuture.event = futureEvent;
      attendeeFuture.subjectUser = user;
      attendeeFuture.rsvpStatus = EventRsvpStatus.GOING;

      const attendeeCancelled = new EventAttendee();
      attendeeCancelled.event = cancelledEvent;
      attendeeCancelled.subjectUser = user;
      attendeeCancelled.rsvpStatus = EventRsvpStatus.GOING;

      const em = buildMockEm({
        attendees: [attendeeFuture, attendeeCancelled],
      });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('EventAttendance integration (attended overrides RSVP)', () => {
    it('includes the Event when attended=true, even though RSVP is NOT_GOING', async () => {
      const user = buildUser();
      const event = buildEvent();
      const attendee = new EventAttendee();
      attendee.event = event;
      attendee.subjectUser = user;
      attendee.rsvpStatus = EventRsvpStatus.NOT_GOING;
      attendee.checkedIn = true;
      attendee.checkedInAt = new Date('2024-01-01T18:05:00.000Z');

      const em = buildMockEm({ attendees: [attendee] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe(CareerTimelineCategory.EVENT);
    });

    it('excludes the Event when attended=false, even though RSVP is GOING', async () => {
      const user = buildUser();
      const event = buildEvent();
      const attendee = new EventAttendee();
      attendee.event = event;
      attendee.subjectUser = user;
      attendee.rsvpStatus = EventRsvpStatus.GOING;
      attendee.checkedIn = false;
      attendee.checkedInAt = new Date('2024-01-01T18:05:00.000Z');

      const em = buildMockEm({ attendees: [attendee] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });

    it('falls back to RSVP GOING when no attendance was ever recorded (checkedInAt null)', async () => {
      const user = buildUser();
      const event = buildEvent();
      const attendee = new EventAttendee();
      attendee.event = event;
      attendee.subjectUser = user;
      attendee.rsvpStatus = EventRsvpStatus.GOING;
      attendee.checkedIn = false;
      attendee.checkedInAt = null;

      const em = buildMockEm({ attendees: [attendee] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(1);
      expect(result.items[0].category).toBe(CareerTimelineCategory.EVENT);
    });

    it('excludes the Event via RSVP fallback when checkedInAt is null and RSVP is not GOING', async () => {
      const user = buildUser();
      const event = buildEvent();
      const attendee = new EventAttendee();
      attendee.event = event;
      attendee.subjectUser = user;
      attendee.rsvpStatus = EventRsvpStatus.MAYBE;
      attendee.checkedIn = false;
      attendee.checkedInAt = null;

      const em = buildMockEm({ attendees: [attendee] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });

      expect(result.items).toHaveLength(0);
    });
  });

  describe('sorting and pagination', () => {
    it('sorts descending by occurredOn with a deterministic id tie-break, and paginates', async () => {
      const user = buildUser();
      const entryA = new CareerTimelineEntry();
      entryA.id = 'aaaa';
      entryA.occurredOn = new Date('2023-05-01');
      entryA.title = 'Entry A';

      const entryB = new CareerTimelineEntry();
      entryB.id = 'zzzz';
      entryB.occurredOn = new Date('2023-05-01');
      entryB.title = 'Entry B';

      const entryC = new CareerTimelineEntry();
      entryC.id = 'cccc';
      entryC.occurredOn = new Date('2024-01-01');
      entryC.title = 'Entry C';

      const em = buildMockEm({ entries: [entryA, entryB, entryC] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const full = await service.getTimeline(user, user.id, {
        limit: 20,
        offset: 0,
      });
      expect(full.items.map((item) => item.id)).toEqual([
        'cccc',
        'aaaa',
        'zzzz',
      ]);
      expect(full.total).toBe(3);
      expect(full.hasMore).toBe(false);

      const page1 = await service.getTimeline(user, user.id, {
        limit: 2,
        offset: 0,
      });
      expect(page1.items.map((item) => item.id)).toEqual(['cccc', 'aaaa']);
      expect(page1.hasMore).toBe(true);

      const page2 = await service.getTimeline(user, user.id, {
        limit: 2,
        offset: 2,
      });
      expect(page2.items.map((item) => item.id)).toEqual(['zzzz']);
      expect(page2.hasMore).toBe(false);
    });
  });

  describe('date range filtering', () => {
    it('applies dateFrom/dateTo against occurredOn', async () => {
      const user = buildUser();
      const early = new CareerTimelineEntry();
      early.id = 'early';
      early.occurredOn = new Date('2020-01-01');
      early.title = 'Early';

      const late = new CareerTimelineEntry();
      late.id = 'late';
      late.occurredOn = new Date('2025-01-01');
      late.title = 'Late';

      const em = buildMockEm({ entries: [early, late] });
      const service = new CareerTimelineAggregationService(
        em,
        buildMockCorrectionService().service,
        buildMockEventAccessService(),
        buildMockR2StorageService(),
      );

      const result = await service.getTimeline(user, user.id, {
        dateFrom: '2021-01-01',
        limit: 20,
        offset: 0,
      });

      expect(result.items.map((item) => item.id)).toEqual(['late']);
    });
  });
});
