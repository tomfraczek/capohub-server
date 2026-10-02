import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventResponseDto } from '../events/dto/event-response.dto';
import { EventRsvpStatus } from '../events/enums/event-rsvp-status.enum';
import { EventStatus } from '../events/enums/event-status.enum';
import { EventType } from '../events/enums/event-type.enum';
import { EventVisibility } from '../events/enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../events/enums/event-waitlist-policy.enum';
import { EventsService } from '../events/events.service';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { TrainingResponseDto } from '../trainings/dto/training-response.dto';
import { TrainingStatus } from '../trainings/enums/training-status.enum';
import { TrainingVisibility } from '../trainings/enums/training-visibility.enum';
import { TrainingsService } from '../trainings/trainings.service';
import { User } from '../users/entities/user.entity';
import { CalendarService } from './calendar.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'user@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Downtown Section';
  return Object.assign(section, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordao de Ouro';
  return Object.assign(group, overrides);
}

function buildEvent(
  overrides: Partial<EventResponseDto> = {},
): EventResponseDto {
  return {
    id: 'event-1',
    organizer: {
      type: 'SECTION',
      id: 'section-1',
      name: 'Downtown Section',
      image: { url: null },
    },
    community: {
      id: 'section-1',
      name: 'Downtown Section',
      logoUrl: null,
      isRootGroup: false,
      communityType: 'SECTION',
    },
    createdByUserId: 'user-2',
    type: EventType.FESTIVAL,
    customTypeLabel: null,
    name: 'Roda Grande',
    description: null,
    coverImageUrl: null,
    startsAt: '2026-01-10T18:00:00.000Z',
    endsAt: '2026-01-10T21:00:00.000Z',
    isMultiDay: false,
    locationName: null,
    locationAddress: null,
    scheduleDays: [],
    visibility: EventVisibility.PUBLIC,
    status: EventStatus.PUBLISHED,
    capacity: null,
    waitlistPolicy: EventWaitlistPolicy.NONE,
    participantsVisibility: 'PRIVATE' as never,
    seatsTaken: 0,
    seatsAvailable: null,
    waitlistCount: 0,
    publicCode: null,
    numericCode: '042981',
    qrPayload: 'capohub:v1:f:042981',
    viewerRoles: [],
    capabilities: {
      canViewManagement: false,
      canEdit: false,
      canPublish: false,
      canCancel: false,
      canFinish: false,
      canManageOrganizers: false,
      canManageModerators: false,
      canTransferOwnership: false,
      canManageInvitations: false,
      canManageParticipants: false,
      canCheckIn: false,
      canViewParticipants: false,
      canRegister: true,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildTraining(
  overrides: Partial<TrainingResponseDto> = {},
): TrainingResponseDto {
  return {
    id: 'training-1',
    section: { id: 'section-1', name: 'Downtown Section', logoUrl: null },
    seriesId: null,
    startsAt: '2026-01-12T18:00:00.000Z',
    endsAt: '2026-01-12T20:00:00.000Z',
    locationName: null,
    locationAddress: null,
    trainer: { id: 'trainer-1', displayName: 'Mestre Ada', gender: null },
    description: null,
    visibility: TrainingVisibility.MEMBERS_ONLY,
    status: TrainingStatus.SCHEDULED,
    rsvpCounts: { yes: 0, no: 0, maybe: 0 },
    viewerRsvp: null,
    management: null,
    capabilities: {
      canEdit: false,
      canCancel: false,
      canManageAttendance: false,
      canManagePlanNotes: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function buildMockEm(overrides: Record<string, jest.Mock> = {}) {
  return {
    find: jest.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as EntityManager;
}

function buildServices(
  overrides: {
    em?: EntityManager;
    eventsService?: Partial<EventsService>;
    trainingsService?: Partial<TrainingsService>;
    groupHierarchyService?: Partial<GroupHierarchyService>;
  } = {},
) {
  const em = overrides.em ?? buildMockEm();
  const eventsService = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0, hasMore: false }),
    findForViewerInRange: jest.fn().mockResolvedValue([]),
    ...overrides.eventsService,
  } as unknown as EventsService;
  const trainingsService = {
    list: jest.fn().mockResolvedValue({ items: [], total: 0, hasMore: false }),
    findForViewerSectionsInRange: jest.fn().mockResolvedValue([]),
    ...overrides.trainingsService,
  } as unknown as TrainingsService;
  const groupHierarchyService = {
    findCommunityById: jest.fn().mockResolvedValue(null),
    ...overrides.groupHierarchyService,
  } as unknown as GroupHierarchyService;

  const service = new CalendarService(
    em,
    eventsService,
    trainingsService,
    groupHierarchyService,
  );
  return {
    service,
    em,
    eventsService,
    trainingsService,
    groupHierarchyService,
  };
}

const RANGE = {
  from: '2026-01-01T00:00:00.000Z',
  to: '2026-02-01T00:00:00.000Z',
};

describe('CalendarService.getUserCalendar', () => {
  it('merges Events and Trainings from the two participation-based sources, sorted', async () => {
    const event = buildEvent({
      id: 'e1',
      startsAt: '2026-01-20T00:00:00.000Z',
      endsAt: '2026-01-20T01:00:00.000Z',
    });
    const training = buildTraining({
      id: 't1',
      startsAt: '2026-01-05T00:00:00.000Z',
      endsAt: '2026-01-05T01:00:00.000Z',
    });
    const findForViewerInRange = jest.fn().mockResolvedValue([event]);
    const findForViewerSectionsInRange = jest
      .fn()
      .mockResolvedValue([training]);
    const { service } = buildServices({
      eventsService: { findForViewerInRange },
      trainingsService: { findForViewerSectionsInRange },
    });

    const result = await service.getUserCalendar(buildUser(), RANGE);

    expect(result.items.map((item) => item.id)).toEqual([
      'training:t1',
      'event:e1',
    ]);
    expect(findForViewerInRange).toHaveBeenCalledWith(
      expect.anything(),
      RANGE.from,
      RANGE.to,
    );
    expect(findForViewerSectionsInRange).toHaveBeenCalledWith(
      expect.anything(),
      RANGE.from,
      RANGE.to,
    );
  });

  it("attaches the caller's own EventAttendee.rsvpStatus via one bulk lookup, never per item", async () => {
    const eventA = buildEvent({ id: 'e1' });
    const eventB = buildEvent({ id: 'e2' });
    const find = jest
      .fn()
      .mockResolvedValue([
        { event: { id: 'e1' }, rsvpStatus: EventRsvpStatus.GOING },
      ]);
    const { service } = buildServices({
      em: buildMockEm({ find }),
      eventsService: {
        findForViewerInRange: jest.fn().mockResolvedValue([eventA, eventB]),
      },
    });

    const result = await service.getUserCalendar(buildUser(), RANGE);

    expect(find).toHaveBeenCalledTimes(1);
    const items = result.items.filter(
      (item) => item.type === 'EVENT',
    ) as Array<{ sourceId: string; viewerRsvp: EventRsvpStatus | null }>;
    expect(items.find((item) => item.sourceId === 'e1')?.viewerRsvp).toBe(
      EventRsvpStatus.GOING,
    );
    expect(items.find((item) => item.sourceId === 'e2')?.viewerRsvp).toBeNull();
  });

  it('returns an empty item list, not an error, when nothing is found', async () => {
    const { service } = buildServices();
    const result = await service.getUserCalendar(buildUser(), RANGE);
    expect(result).toEqual({ from: RANGE.from, to: RANGE.to, items: [] });
  });
});

describe('CalendarService.getSectionCalendar', () => {
  it('404s when the id resolves to a Group, not a Section (no route-kind confusion)', async () => {
    const { service } = buildServices({
      groupHierarchyService: {
        findCommunityById: jest.fn().mockResolvedValue(buildGroup()),
      },
    });

    await expect(
      service.getSectionCalendar('group-1', buildUser(), RANGE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404s when the id does not resolve to any Community', async () => {
    const { service } = buildServices();
    await expect(
      service.getSectionCalendar('missing', buildUser(), RANGE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('calls TrainingsService.list/EventsService.list exactly once each, never per item', async () => {
    const eventsList = jest.fn().mockResolvedValue({
      items: [buildEvent(), buildEvent({ id: 'e2' })],
      total: 2,
      hasMore: false,
    });
    const trainingsList = jest.fn().mockResolvedValue({
      items: [buildTraining()],
      total: 1,
      hasMore: false,
    });
    const { service } = buildServices({
      groupHierarchyService: {
        findCommunityById: jest.fn().mockResolvedValue(buildSection()),
      },
      eventsService: { list: eventsList },
      trainingsService: { list: trainingsList },
    });

    const result = await service.getSectionCalendar(
      'section-1',
      buildUser(),
      RANGE,
    );

    expect(eventsList).toHaveBeenCalledTimes(1);
    expect(trainingsList).toHaveBeenCalledTimes(1);
    expect(result.items).toHaveLength(3);
  });

  it('throws an explicit error instead of silently truncating when a source exceeds the hard limit', async () => {
    const tooMany = Array.from({ length: 501 }, (_, i) =>
      buildEvent({ id: `e${i}` }),
    );
    const { service } = buildServices({
      groupHierarchyService: {
        findCommunityById: jest.fn().mockResolvedValue(buildSection()),
      },
      eventsService: {
        list: jest
          .fn()
          .mockResolvedValue({ items: tooMany, total: 501, hasMore: false }),
      },
    });

    await expect(
      service.getSectionCalendar('section-1', buildUser(), RANGE),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('CalendarService.getGroupCalendar', () => {
  it('404s when the id resolves to a Section, not a Group', async () => {
    const { service } = buildServices({
      groupHierarchyService: {
        findCommunityById: jest.fn().mockResolvedValue(buildSection()),
      },
    });

    await expect(
      service.getGroupCalendar('section-1', buildUser(), RANGE),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never calls TrainingsService - a Group owns no Training directly', async () => {
    const trainingsList = jest.fn().mockResolvedValue({
      items: [],
      total: 0,
      hasMore: false,
    });
    const findForViewerSectionsInRange = jest.fn().mockResolvedValue([]);
    const { service } = buildServices({
      groupHierarchyService: {
        findCommunityById: jest.fn().mockResolvedValue(buildGroup()),
      },
      eventsService: {
        list: jest.fn().mockResolvedValue({
          items: [buildEvent()],
          total: 1,
          hasMore: false,
        }),
      },
      trainingsService: { list: trainingsList, findForViewerSectionsInRange },
    });

    const result = await service.getGroupCalendar(
      'group-1',
      buildUser(),
      RANGE,
    );

    expect(trainingsList).not.toHaveBeenCalled();
    expect(findForViewerSectionsInRange).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
    expect(result.items[0].type).toBe('EVENT');
  });
});
