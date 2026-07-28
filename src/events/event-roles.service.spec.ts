import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from './event-access.service';
import { EventRoleAssignment } from './entities/event-role-assignment.entity';
import { Event } from './entities/event.entity';
import { EventRole } from './enums/event-role.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventRolesService } from './event-roles.service';

const ACTOR = { id: 'actor-1', displayName: 'Actor' } as never;

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  return Object.assign(event, overrides);
}

function buildRoleAssignment(
  overrides: Partial<EventRoleAssignment> = {},
): EventRoleAssignment {
  const assignment = new EventRoleAssignment();
  assignment.id = 'role-assignment-1';
  assignment.event = buildEvent();
  assignment.user = { id: 'user-1', displayName: 'Member' } as never;
  assignment.role = EventRole.MODERATOR;
  assignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(assignment, overrides);
}

interface MockRouting {
  eventRoleAssignmentResults?: (EventRoleAssignment | null)[];
  userRolesForActor?: EventRole[];
}

function buildMockEm(routing: MockRouting = {}) {
  const queue = [...(routing.eventRoleAssignmentResults ?? [])];
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });
  const getReference = jest.fn((_entity: unknown, id: string) => ({ id }));

  const findOne = jest.fn((entity: unknown) => {
    if (entity === EventRoleAssignment) {
      return Promise.resolve(queue.shift() ?? null);
    }
    throw new Error(`Unexpected findOne entity: ${String(entity)}`);
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === EventRoleAssignment) {
      return Promise.resolve(
        (routing.userRolesForActor ?? []).map((role) =>
          buildRoleAssignment({ role }),
        ),
      );
    }
    throw new Error(`Unexpected find entity: ${String(entity)}`);
  });

  const raw = {
    findOne,
    find,
    persist,
    remove,
    flush,
    getReference,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return {
    em: raw as unknown as EntityManager,
    persist,
    remove,
    findOne,
    find,
  };
}

function buildService(
  em: EntityManager,
  event: Event = buildEvent(),
  options: { isMember?: boolean } = {},
) {
  const eventAccessService = {
    loadOrFail: jest.fn().mockResolvedValue(event),
    getRootGroupId: jest.fn().mockResolvedValue('root-1'),
    isActiveCommunityMember: jest
      .fn()
      .mockResolvedValue(options.isMember ?? true),
  } as unknown as EventAccessService;

  return new EventRolesService(em, eventAccessService);
}

describe('EventRolesService', () => {
  describe('grantRole', () => {
    it('grants MODERATOR when the actor already holds ORGANIZER', async () => {
      const { em } = buildMockEm({ userRolesForActor: [EventRole.ORGANIZER] });
      const service = buildService(em);

      const result = await service.grantRole(
        'event-1',
        { userId: 'user-2', role: EventRole.MODERATOR },
        ACTOR,
      );

      expect(result.role).toBe(EventRole.MODERATOR);
      expect(result.userId).toBe('user-2');
    });

    it('rejects granting ORGANIZER unless the actor is OWNER', async () => {
      const { em } = buildMockEm({ userRolesForActor: [EventRole.ORGANIZER] });
      const service = buildService(em);

      await expect(
        service.grantRole(
          'event-1',
          { userId: 'user-2', role: EventRole.ORGANIZER },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows granting ORGANIZER when the actor is OWNER', async () => {
      const { em } = buildMockEm({ userRolesForActor: [EventRole.OWNER] });
      const service = buildService(em);

      const result = await service.grantRole(
        'event-1',
        { userId: 'user-2', role: EventRole.ORGANIZER },
        ACTOR,
      );

      expect(result.role).toBe(EventRole.ORGANIZER);
    });

    it('rejects granting a role to a non-member of the Event community', async () => {
      const { em } = buildMockEm({ userRolesForActor: [EventRole.OWNER] });
      const service = buildService(em, buildEvent(), { isMember: false });

      await expect(
        service.grantRole(
          'event-1',
          { userId: 'user-2', role: EventRole.MODERATOR },
          ACTOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_ROLE_TARGET_NOT_COMMUNITY_MEMBER' },
      });
    });

    it('rejects a duplicate role grant', async () => {
      const { em } = buildMockEm({
        userRolesForActor: [EventRole.OWNER],
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.MODERATOR }),
        ],
      });
      const service = buildService(em);

      await expect(
        service.grantRole(
          'event-1',
          { userId: 'user-2', role: EventRole.MODERATOR },
          ACTOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_ROLE_ALREADY_EXISTS' },
      });
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects granting a role once the event is %s',
      async (status) => {
        const { em } = buildMockEm({ userRolesForActor: [EventRole.OWNER] });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.grantRole(
            'event-1',
            { userId: 'user-2', role: EventRole.MODERATOR },
            ACTOR,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it.each([EventStatus.DRAFT, EventStatus.PUBLISHED])(
      'allows granting a role while the event is %s',
      async (status) => {
        const { em } = buildMockEm({ userRolesForActor: [EventRole.OWNER] });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.grantRole(
            'event-1',
            { userId: 'user-2', role: EventRole.MODERATOR },
            ACTOR,
          ),
        ).resolves.toMatchObject({ role: EventRole.MODERATOR });
      },
    );
  });

  describe('revokeRole', () => {
    it('rejects revoking OWNER', async () => {
      const { em } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.OWNER }),
        ],
      });
      const service = buildService(em);

      await expect(
        service.revokeRole('event-1', 'role-assignment-1', ACTOR),
      ).rejects.toMatchObject({
        response: { code: 'CANNOT_REMOVE_EVENT_OWNER' },
      });
    });

    it('rejects revoking ORGANIZER unless the actor is OWNER', async () => {
      const { em } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.ORGANIZER }),
        ],
        userRolesForActor: [EventRole.ORGANIZER],
      });
      const service = buildService(em);

      await expect(
        service.revokeRole('event-1', 'role-assignment-1', ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('allows revoking MODERATOR without extra checks', async () => {
      const { em, remove } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.MODERATOR }),
        ],
      });
      const service = buildService(em);

      await service.revokeRole('event-1', 'role-assignment-1', ACTOR);

      expect(remove).toHaveBeenCalledTimes(1);
    });

    it('throws EVENT_ROLE_ASSIGNMENT_NOT_FOUND when the row does not exist', async () => {
      const { em } = buildMockEm({ eventRoleAssignmentResults: [null] });
      const service = buildService(em);

      await expect(
        service.revokeRole('event-1', 'missing', ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects revoking a role once the event is %s',
      async (status) => {
        const { em } = buildMockEm({
          eventRoleAssignmentResults: [
            buildRoleAssignment({ role: EventRole.MODERATOR }),
          ],
        });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.revokeRole('event-1', 'role-assignment-1', ACTOR),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });

  describe('transferOwnership', () => {
    it('rejects transfer when the caller is not the current owner', async () => {
      const { em } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({
            role: EventRole.OWNER,
            user: { id: 'someone-else' } as never,
          }),
        ],
      });
      const service = buildService(em);

      await expect(
        service.transferOwnership('event-1', { toUserId: 'user-2' }, ACTOR),
      ).rejects.toMatchObject({
        response: { code: 'NOT_CURRENT_EVENT_OWNER' },
      });
    });

    it('rejects transferring to self', async () => {
      const { em } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.OWNER, user: ACTOR }),
        ],
      });
      const service = buildService(em);

      await expect(
        service.transferOwnership('event-1', { toUserId: 'actor-1' }, ACTOR),
      ).rejects.toMatchObject({
        response: { code: 'CANNOT_TRANSFER_TO_SELF' },
      });
    });

    it('removes the old OWNER row and inserts a new one', async () => {
      const { em, remove, persist } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.OWNER, user: ACTOR }),
        ],
      });
      const service = buildService(em);

      const result = await service.transferOwnership(
        'event-1',
        { toUserId: 'user-2' },
        ACTOR,
      );

      expect(remove).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(result.role).toBe(EventRole.OWNER);
      expect(result.userId).toBe('user-2');
    });

    it('rejects transferring to a non-member of the Event community', async () => {
      const { em } = buildMockEm({
        eventRoleAssignmentResults: [
          buildRoleAssignment({ role: EventRole.OWNER, user: ACTOR }),
        ],
      });
      const service = buildService(em, buildEvent(), { isMember: false });

      await expect(
        service.transferOwnership('event-1', { toUserId: 'user-2' }, ACTOR),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_ROLE_TARGET_NOT_COMMUNITY_MEMBER' },
      });
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects transferring ownership once the event is %s',
      async (status) => {
        const { em } = buildMockEm({
          eventRoleAssignmentResults: [
            buildRoleAssignment({ role: EventRole.OWNER, user: ACTOR }),
          ],
        });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.transferOwnership('event-1', { toUserId: 'user-2' }, ACTOR),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });

  describe('findOwnedActiveEvents', () => {
    it('excludes CANCELLED and FINISHED events', async () => {
      const em = {
        find: jest
          .fn()
          .mockResolvedValue([
            { event: buildEvent({ id: 'e1', status: EventStatus.DRAFT }) },
            { event: buildEvent({ id: 'e2', status: EventStatus.PUBLISHED }) },
            { event: buildEvent({ id: 'e3', status: EventStatus.CANCELLED }) },
            { event: buildEvent({ id: 'e4', status: EventStatus.FINISHED }) },
          ]),
      } as unknown as EntityManager;
      const eventAccessService = {} as EventAccessService;
      const service = new EventRolesService(em, eventAccessService);

      const result = await service.findOwnedActiveEvents(em, 'user-1');

      expect(result.map((e) => e.id)).toEqual(['e1', 'e2']);
    });
  });
});
