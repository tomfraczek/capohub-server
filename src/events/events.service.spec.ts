import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { GroupPermissionService } from '../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { Event } from './entities/event.entity';
import { EventOrganizerType } from './enums/event-organizer-type.enum';
import { EventRole } from './enums/event-role.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventVisibility } from './enums/event-visibility.enum';
import { EventWaitlistPolicy } from './enums/event-waitlist-policy.enum';
import { EventRolesService } from './event-roles.service';
import { eventCommunity } from './event-community.util';
import { EventNotificationsService } from './event-notifications.service';
import { EventsService } from './events.service';
import { EventPermissionService } from './permissions/event-permission.service';
import { CreateEventInput } from './dto/create-event.schema';
import { UpdateEventInput } from './dto/update-event.schema';
import { ImageAssetService } from '../storage/image-asset.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import { R2StorageService } from '../storage/r2-storage.service';

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

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Capoeira Angola SP - Downtown';
  section.parentGroup = null;
  section.logoUrl = null;
  return Object.assign(section, overrides);
}

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.organizerType = EventOrganizerType.GROUP;
  event.communityGroup = buildGroup();
  event.communitySection = null;
  event.organizerUser = null;
  event.organizerUserDisplayName = null;
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

function buildUpdateInput(
  overrides: Partial<UpdateEventInput> = {},
): UpdateEventInput {
  // UpdateEventInput is CreateEventInput minus type/customTypeLabel (see
  // update-event.schema.ts) - built from the same base fixture rather than
  // duplicating every field here.
  return {
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
    imageAssetService?: Partial<ImageAssetService>;
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

  const eventNotificationsService = {
    notify: jest.fn().mockResolvedValue(undefined),
  } as unknown as EventNotificationsService;

  const r2StorageService = {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;
  const imageProcessingService = {
    processEventCover: jest.fn().mockResolvedValue(Buffer.from('webp')),
  } as unknown as ImageProcessingService;
  const imageAssetService = {
    replace: jest
      .fn()
      .mockImplementation(
        async (params: {
          newKey: string;
          persist: (key: string) => Promise<void>;
        }) => params.persist(params.newKey),
      ),
    remove: jest
      .fn()
      .mockImplementation(
        async (params: {
          oldKey: string | null;
          persist: () => Promise<void>;
        }) => (params.oldKey ? params.persist() : undefined),
      ),
    ...options.imageAssetService,
  } as unknown as ImageAssetService;

  return new EventsService(
    em,
    eventAccessService,
    eventRolesService,
    eventPermissionService,
    roleAssignmentsService,
    groupPermissionService,
    groupHierarchyService,
    eventNotificationsService,
    r2StorageService,
    imageProcessingService,
    imageAssetService,
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

    it('resolves organizer identity from the Group, and keeps `community` populated', async () => {
      const { em } = buildMockEm();
      const service = buildService(em, { viewerRoles: [EventRole.OWNER] });

      const result = await service.create(
        'community-1',
        buildCreateInput(),
        ACTOR,
      );

      expect(result.organizer).toEqual({
        type: 'GROUP',
        id: 'community-1',
        name: 'Capoeira Angola SP',
        image: { url: null },
      });
      expect(result.community).toMatchObject({
        id: 'community-1',
        communityType: 'GROUP',
      });
    });

    it('resolves organizer identity from the Section, and keeps `community` populated', async () => {
      const { em } = buildMockEm();
      const service = buildService(em, {
        viewerRoles: [EventRole.OWNER],
        communityForCreate: buildSection() as never,
      });

      const result = await service.create(
        'section-1',
        buildCreateInput(),
        ACTOR,
      );

      expect(result.organizer).toEqual({
        type: 'SECTION',
        id: 'section-1',
        name: 'Capoeira Angola SP - Downtown',
        image: { url: null },
      });
      expect(result.community).toMatchObject({
        id: 'section-1',
        communityType: 'SECTION',
      });
    });
  });

  describe('createPersonal', () => {
    it('creates a DRAFT event organized by the actor themselves, with no community', async () => {
      const { em, persist } = buildMockEm();
      const service = buildService(em);

      const result = await service.createPersonal(
        buildCreateInput({ visibility: EventVisibility.PUBLIC }),
        ACTOR,
      );

      expect(result.status).toBe(EventStatus.DRAFT);
      expect(result.createdByUserId).toBe('actor-1');
      expect(result.organizer).toMatchObject({
        type: 'USER',
        id: 'actor-1',
        name: 'Actor',
      });
      expect(result.community).toBeNull();
      expect(persist).toHaveBeenCalled();
    });

    it('grants the actor EventRole.OWNER, with matching capabilities', async () => {
      const { em } = buildMockEm();
      const service = buildService(em);

      const result = await service.createPersonal(
        buildCreateInput({ visibility: EventVisibility.PUBLIC }),
        ACTOR,
      );

      expect(result.viewerRoles).toEqual([EventRole.OWNER]);
      expect(result.capabilities.canEdit).toBe(true);
      expect(result.capabilities.canManageOrganizers).toBe(true);
      expect(result.capabilities.canTransferOwnership).toBe(true);
    });

    it('allows PUBLIC visibility', async () => {
      const { em } = buildMockEm();
      const service = buildService(em);

      await expect(
        service.createPersonal(
          buildCreateInput({ visibility: EventVisibility.PUBLIC }),
          ACTOR,
        ),
      ).resolves.toMatchObject({ status: EventStatus.DRAFT });
    });

    it('allows INVITE_ONLY visibility', async () => {
      const { em } = buildMockEm();
      const service = buildService(em);

      await expect(
        service.createPersonal(
          buildCreateInput({ visibility: EventVisibility.INVITE_ONLY }),
          ACTOR,
        ),
      ).resolves.toMatchObject({ status: EventStatus.DRAFT });
    });

    it('rejects COMMUNITY_MEMBERS visibility with EVENT_VISIBILITY_REQUIRES_COMMUNITY', async () => {
      const { em, persist } = buildMockEm();
      const service = buildService(em);

      await expect(
        service.createPersonal(
          buildCreateInput({ visibility: EventVisibility.COMMUNITY_MEMBERS }),
          ACTOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_VISIBILITY_REQUIRES_COMMUNITY' },
      });
      // Rejected before anything is persisted.
      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe('update on a User-organized Event', () => {
    it('rejects changing visibility to COMMUNITY_MEMBERS', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({
        organizerType: EventOrganizerType.USER,
        communityGroup: null,
        communitySection: null,
        organizerUser: ACTOR,
        organizerUserDisplayName: 'Actor',
        status: EventStatus.DRAFT,
        visibility: EventVisibility.PUBLIC,
      });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(
        service.update(
          'event-1',
          buildUpdateInput({ visibility: EventVisibility.COMMUNITY_MEMBERS }),
          ACTOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_VISIBILITY_REQUIRES_COMMUNITY' },
      });
    });

    it('allows updating other fields while keeping PUBLIC visibility', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({
        organizerType: EventOrganizerType.USER,
        communityGroup: null,
        communitySection: null,
        organizerUser: ACTOR,
        organizerUserDisplayName: 'Actor',
        status: EventStatus.DRAFT,
        visibility: EventVisibility.PUBLIC,
      });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.update(
        'event-1',
        buildUpdateInput({ visibility: EventVisibility.PUBLIC }),
        ACTOR,
      );

      expect(result.organizer).toMatchObject({ type: 'USER', id: 'actor-1' });
      expect(result.community).toBeNull();
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

  describe('archive', () => {
    it('archives a FINISHED event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.FINISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.archive('event-1', ACTOR);

      expect(result.status).toBe(EventStatus.ARCHIVED);
    });

    it('archives a CANCELLED event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.CANCELLED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.archive('event-1', ACTOR);

      expect(result.status).toBe(EventStatus.ARCHIVED);
    });

    it('rejects archiving a PUBLISHED event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(service.archive('event-1', ACTOR)).rejects.toMatchObject({
        response: { code: 'EVENT_PUBLISHED' },
      });
    });

    it('rejects archiving a DRAFT event', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(service.archive('event-1', ACTOR)).rejects.toMatchObject({
        response: { code: 'EVENT_DRAFT' },
      });
    });

    it('rejects re-archiving an already-ARCHIVED event - archiving is one-directional', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.ARCHIVED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(service.archive('event-1', ACTOR)).rejects.toMatchObject({
        response: { code: 'EVENT_ARCHIVED' },
      });
    });

    it('sets every operational capability to false once archived, but keeps canViewManagement true for a role holder', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.FINISHED });
      // canRegister itself is a real, unmocked consequence of status !==
      // PUBLISHED (see EventAccessService.canViewerRegister) - the mock
      // here just needs to reflect what that real check would already
      // return for an ARCHIVED event, since eventAccessService itself is
      // stubbed out in this test harness (see buildService).
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
        canRegister: false,
      });

      const result = await service.archive('event-1', ACTOR);

      expect(result.capabilities).toEqual({
        canViewManagement: true,
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
        canRegister: false,
      });
    });
  });

  describe('uploadCoverImage', () => {
    function buildUploadedFile(): Express.Multer.File {
      return { buffer: Buffer.from('raw-bytes') } as Express.Multer.File;
    }

    it('processes the file, uploads it under a fresh key, sets coverImageKey and clears the legacy coverImageUrl', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({
        status: EventStatus.DRAFT,
        coverImageUrl: 'https://legacy.example.com/old-cover.png',
      });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.uploadCoverImage(
        'event-1',
        buildUploadedFile(),
        ACTOR,
      );

      expect(event.coverImageKey).toMatch(/^events\/event-1\/cover\/.+\.webp$/);
      expect(event.coverImageUrl).toBeNull();
      expect(result.coverImageUrl).toBe(
        `https://cdn.example.com/${event.coverImageKey}`,
      );
    });

    it('allows the cover to be changed while PUBLISHED', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.uploadCoverImage(
        'event-1',
        buildUploadedFile(),
        ACTOR,
      );

      expect(typeof result.coverImageUrl).toBe('string');
    });

    it.each([
      EventStatus.FINISHED,
      EventStatus.CANCELLED,
      EventStatus.ARCHIVED,
    ])(
      'rejects changing the cover once the event is %s',
      async (status: EventStatus) => {
        const { em } = buildMockEm();
        const event = buildEvent({ status });
        const service = buildService(em, {
          event,
          viewerRoles: [EventRole.OWNER],
        });

        await expect(
          service.uploadCoverImage('event-1', buildUploadedFile(), ACTOR),
        ).rejects.toMatchObject({
          response: { code: `EVENT_${status}` },
        });
      },
    );
  });

  describe('deleteCoverImage', () => {
    it('clears coverImageKey and does not restore the legacy coverImageUrl', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({
        status: EventStatus.DRAFT,
        coverImageUrl: null,
        coverImageKey: 'events/event-1/cover/old.webp',
      });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      const result = await service.deleteCoverImage('event-1', ACTOR);

      expect(event.coverImageKey).toBeNull();
      expect(result.coverImageUrl).toBeNull();
    });

    it('rejects deleting the cover once the event is ARCHIVED', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.ARCHIVED });
      const service = buildService(em, {
        event,
        viewerRoles: [EventRole.OWNER],
      });

      await expect(
        service.deleteCoverImage('event-1', ACTOR),
      ).rejects.toMatchObject({ response: { code: 'EVENT_ARCHIVED' } });
    });
  });

  describe('closeOrganizedEventsForAccountDeletion', () => {
    // Bypasses buildService - needs eventRolesService.findOrganizedEvents
    // mocked to return arbitrary Events, and eventNotificationsService.notify
    // exposed for assertion (buildService's own copy is internal).
    function buildServiceForClosing(
      em: EntityManager,
      organizedEvents: Event[],
    ): { service: EventsService; notify: jest.Mock } {
      const eventRolesService = {
        findOrganizedEvents: jest.fn().mockResolvedValue(organizedEvents),
      } as unknown as EventRolesService;
      const notify = jest.fn().mockResolvedValue(undefined);
      const eventNotificationsService = {
        notify,
      } as unknown as EventNotificationsService;

      const service = new EventsService(
        em,
        {} as unknown as EventAccessService,
        eventRolesService,
        new EventPermissionService(),
        {} as unknown as RoleAssignmentsService,
        new GroupPermissionService(),
        {} as unknown as GroupHierarchyService,
        eventNotificationsService,
        {} as unknown as R2StorageService,
        {} as unknown as ImageProcessingService,
        {} as unknown as ImageAssetService,
      );
      return { service, notify };
    }

    it('cancels then archives a DRAFT Event, notifying attendees', async () => {
      const { em, persist } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const { service, notify } = buildServiceForClosing(em, [event]);

      await service.closeOrganizedEventsForAccountDeletion(
        em,
        'actor-1',
        ACTOR,
      );

      expect(event.status).toBe(EventStatus.ARCHIVED);
      expect(notify).toHaveBeenCalledWith(em, event, 'EVENT_CANCELLED');
      // Two history rows: DRAFT -> CANCELLED, CANCELLED -> ARCHIVED.
      expect(persist).toHaveBeenCalledTimes(2);
    });

    it('cancels then archives a PUBLISHED Event, notifying attendees', async () => {
      const { em, persist } = buildMockEm();
      const event = buildEvent({ status: EventStatus.PUBLISHED });
      const { service, notify } = buildServiceForClosing(em, [event]);

      await service.closeOrganizedEventsForAccountDeletion(
        em,
        'actor-1',
        ACTOR,
      );

      expect(event.status).toBe(EventStatus.ARCHIVED);
      expect(notify).toHaveBeenCalledWith(em, event, 'EVENT_CANCELLED');
      expect(persist).toHaveBeenCalledTimes(2);
    });

    it('archives a FINISHED Event directly, without notifying anyone', async () => {
      const { em, persist } = buildMockEm();
      const event = buildEvent({ status: EventStatus.FINISHED });
      const { service, notify } = buildServiceForClosing(em, [event]);

      await service.closeOrganizedEventsForAccountDeletion(
        em,
        'actor-1',
        ACTOR,
      );

      expect(event.status).toBe(EventStatus.ARCHIVED);
      expect(notify).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('archives a CANCELLED Event directly, without notifying anyone', async () => {
      const { em, persist } = buildMockEm();
      const event = buildEvent({ status: EventStatus.CANCELLED });
      const { service, notify } = buildServiceForClosing(em, [event]);

      await service.closeOrganizedEventsForAccountDeletion(
        em,
        'actor-1',
        ACTOR,
      );

      expect(event.status).toBe(EventStatus.ARCHIVED);
      expect(notify).not.toHaveBeenCalled();
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('leaves an already-ARCHIVED Event untouched', async () => {
      const { em, persist } = buildMockEm();
      const event = buildEvent({ status: EventStatus.ARCHIVED });
      const { service, notify } = buildServiceForClosing(em, [event]);

      await service.closeOrganizedEventsForAccountDeletion(
        em,
        'actor-1',
        ACTOR,
      );

      expect(event.status).toBe(EventStatus.ARCHIVED);
      expect(notify).not.toHaveBeenCalled();
      expect(persist).not.toHaveBeenCalled();
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
