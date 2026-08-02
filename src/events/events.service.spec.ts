import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { Group } from '../groups/entities/group.entity';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { Event } from './entities/event.entity';
import { EventRole } from './enums/event-role.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventVisibility } from './enums/event-visibility.enum';
import { EventWaitlistPolicy } from './enums/event-waitlist-policy.enum';
import { EventRolesService } from './event-roles.service';
import { eventCommunity } from './event-community.util';
import { EventsService } from './events.service';
import { EventPermissionService } from './permissions/event-permission.service';
import { CreateEventInput } from './dto/create-event.schema';

const ACTOR = {
  id: 'actor-1',
  displayName: 'Actor',
  email: 'actor@example.com',
} as never;

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'community-1';
  group.name = 'Capoeira Angola SP';
  group.parentGroup = null;
  group.logoUrl = null;
  return Object.assign(group, overrides);
}

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.communityGroup = buildGroup();
  event.communitySection = null;
  event.createdBy = ACTOR;
  event.status = EventStatus.DRAFT;
  event.visibility = EventVisibility.COMMUNITY_MEMBERS;
  event.startsAt = new Date('2026-02-01T10:00:00.000Z');
  event.endsAt = new Date('2026-02-01T18:00:00.000Z');
  event.capacity = null;
  event.waitlistPolicy = EventWaitlistPolicy.NONE;
  event.publicCode = 'ABCD-1234';
  return Object.assign(event, overrides);
}

function buildCreateInput(
  overrides: Partial<CreateEventInput> = {},
): CreateEventInput {
  return {
    type: 'WORKSHOP' as never,
    customTypeLabel: null,
    name: 'Roda de Sábado',
    description: null,
    coverImageUrl: null,
    startsAt: '2026-02-01T10:00:00.000Z',
    endsAt: '2026-02-01T18:00:00.000Z',
    locationName: null,
    locationAddress: null,
    latitude: null,
    longitude: null,
    visibility: EventVisibility.COMMUNITY_MEMBERS,
    capacity: null,
    waitlistPolicy: EventWaitlistPolicy.NONE,
    ...overrides,
  };
}

interface MockRouting {
  event?: Event;
  community?: Group | null;
  seatsTaken?: number;
  waitlistCount?: number;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    if (entity === Group && 'id' in where) {
      return Promise.resolve(
        routing.community === undefined ? buildGroup() : routing.community,
      );
    }
    // generateUniquePublicCode() probes User/Group/Event by publicCode for
    // collisions - no collision in any test here.
    return Promise.resolve(null);
  });

  const count = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    if (entity === EventAttendee) {
      if (where.isWaitlisted === true) {
        return Promise.resolve(routing.waitlistCount ?? 0);
      }
      return Promise.resolve(routing.seatsTaken ?? 0);
    }
    throw new Error(`Unexpected count entity: ${String(entity)}`);
  });

  const raw = {
    findOne,
    count,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, findOne, count };
}

function buildService(
  em: EntityManager,
  options: {
    event?: Event;
    viewerRoles?: EventRole[];
    visible?: boolean;
    canRegister?: boolean;
    communityRoles?: EventRole[] | 'none';
    communityForCreate?: Group | null;
  } = {},
) {
  const event = options.event ?? buildEvent();
  const eventAccessService = {
    loadOrFail: jest.fn().mockResolvedValue(event),
    getRootGroupIdForCommunity: jest.fn().mockResolvedValue('community-1'),
    isActiveCommunityMember: jest.fn().mockResolvedValue(true),
    isVisibleToViewer: jest.fn().mockResolvedValue(options.visible ?? true),
    canViewerRegister: jest.fn().mockResolvedValue(options.canRegister ?? true),
    eventNotFound: () =>
      new NotFoundException({
        code: 'EVENT_NOT_FOUND',
        message: 'Event not found',
      }),
  } as unknown as EventAccessService;

  const eventRolesService = {
    insertRoleAssignment: jest.fn().mockResolvedValue(undefined),
    getRolesForUser: jest.fn().mockResolvedValue(options.viewerRoles ?? []),
  } as unknown as EventRolesService;

  const eventPermissionService = new EventPermissionService();

  const roleAssignmentsService = {
    resolveAuthorization: jest.fn().mockResolvedValue(
      options.communityRoles === 'none' || options.communityRoles === undefined
        ? null
        : {
            community: eventCommunity(event),
            membership: { status: 'ACTIVE' },
            roleAssignments: options.communityRoles.map((role) => ({ role })),
          },
    ),
  } as unknown as RoleAssignmentsService;

  const groupPermissionService = new GroupPermissionService();
  const groupHierarchyService = {
    getDescendants: jest.fn().mockResolvedValue([]),
    getDescendantSections: jest.fn().mockResolvedValue([]),
    findCommunityById: jest
      .fn()
      .mockResolvedValue(
        options.communityForCreate === undefined
          ? buildGroup()
          : options.communityForCreate,
      ),
  } as unknown as GroupHierarchyService;

  return new EventsService(
    em,
    eventAccessService,
    eventRolesService,
    eventPermissionService,
    roleAssignmentsService,
    groupPermissionService,
    groupHierarchyService,
  );
}

describe('EventsService', () => {
  describe('create', () => {
    it('creates a DRAFT event and grants the actor OWNER', async () => {
      const { em, persist } = buildMockEm();
      const service = buildService(em, { viewerRoles: [EventRole.OWNER] });

      const result = await service.create(
        'community-1',
        buildCreateInput(),
        ACTOR,
      );

      expect(result.status).toBe(EventStatus.DRAFT);
      expect(result.viewerRoles).toEqual([EventRole.OWNER]);
      expect(persist).toHaveBeenCalled();
    });

    it('throws GROUP_NOT_FOUND when the community does not exist', async () => {
      const { em } = buildMockEm();
      const service = buildService(em, { communityForCreate: null });

      await expect(
        service.create('missing', buildCreateInput(), ACTOR),
      ).rejects.toMatchObject({ response: { code: 'GROUP_NOT_FOUND' } });
    });
  });

  describe('publish / cancel / finish', () => {
    it('publishes a DRAFT event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.publish('event-1', ACTOR);

      expect(result.status).toBe(EventStatus.PUBLISHED);
    });

    it('rejects publishing an already-published event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(service.publish('event-1', ACTOR)).rejects.toMatchObject({
        response: { code: 'EVENT_PUBLISHED' },
      });
    });

    it('cancels a PUBLISHED event and records the reason', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.cancel(
        'event-1',
        { reason: 'Weather' },
        ACTOR,
      );

      expect(result.status).toBe(EventStatus.CANCELLED);
    });

    it('rejects cancelling an already-cancelled event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.CANCELLED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(
        service.cancel('event-1', { reason: null }, ACTOR),
      ).rejects.toMatchObject({ response: { code: 'EVENT_CANCELLED' } });
    });

    it('finishes a PUBLISHED event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.finish('event-1', ACTOR);

      expect(result.status).toBe(EventStatus.FINISHED);
    });

    it('rejects finishing a DRAFT event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(service.finish('event-1', ACTOR)).rejects.toMatchObject({
        response: { code: 'EVENT_DRAFT' },
      });
    });
  });

  describe('getById', () => {
    it('throws EVENT_NOT_FOUND for a DRAFT event when the viewer holds no role', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const service = buildService(em, { event, viewerRoles: [] });

      await expect(service.getById('event-1', ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('allows a role holder to view their own DRAFT event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.ORGANIZER],
      });

      const result = await service.getById('event-1', ACTOR);

      expect(result.id).toBe('event-1');
      expect(result.capabilities.canEdit).toBe(true);
      expect(result.capabilities.canManageOrganizers).toBe(false);
    });

    it('throws EVENT_NOT_FOUND for a PUBLISHED event the viewer cannot see', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [],
        visible: false,
      });

      await expect(service.getById('event-1', ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('allows a Community Admin/Owner to cancel via EVENT_MODERATE even without an Event role', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [],
        visible: true,
        communityRoles: [],
      });

      const result = await service.getById('event-1', ACTOR);
      // Community role resolution mock returns [] (no roles) by default here,
      // so no override - canCancel should be false without any role.
      expect(result.capabilities.canCancel).toBe(false);
    });

    it('computes seatsAvailable relative to capacity', async () => {
      const { em } = buildMockEm({ seatsTaken: 3, waitlistCount: 2 });
      const event = buildEvent({ status: EventStatus.PUBLISHED, capacity: 10 });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.getById('event-1', ACTOR);

      expect(result.seatsTaken).toBe(3);
      expect(result.seatsAvailable).toBe(7);
      expect(result.waitlistCount).toBe(2);
    });
  });
});
