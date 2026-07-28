import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { EventAccessService } from './event-access.service';
import { EventInvitation } from './entities/event-invitation.entity';
import { Event } from './entities/event.entity';
import { EventInvitationStatus } from './enums/event-invitation-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventInvitationsService } from './event-invitations.service';

const ACTOR = {
  id: 'actor-1',
  displayName: 'Actor',
  email: 'actor@example.com',
} as never;

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  return Object.assign(event, overrides);
}

function buildInvitation(
  overrides: Partial<EventInvitation> = {},
): EventInvitation {
  const invitation = new EventInvitation();
  invitation.id = 'invitation-1';
  invitation.event = buildEvent();
  invitation.invitedBy = ACTOR;
  invitation.invitedUser = {
    id: 'invitee-1',
    email: 'invitee@example.com',
  } as never;
  invitation.invitedEmail = null;
  invitation.status = EventInvitationStatus.PENDING;
  return Object.assign(invitation, overrides);
}

interface MockRouting {
  invitationResult?: EventInvitation | null;
  userResult?: User | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown) => {
    if (entity === User) {
      return Promise.resolve(routing.userResult ?? null);
    }
    if (entity === EventInvitation) {
      return Promise.resolve(routing.invitationResult ?? null);
    }
    throw new Error(`Unexpected findOne entity: ${String(entity)}`);
  });

  const raw = {
    findOne,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, findOne };
}

function buildService(em: EntityManager, event: Event = buildEvent()) {
  const eventAccessService = {
    loadOrFail: jest.fn().mockResolvedValue(event),
  } as unknown as EventAccessService;

  return new EventInvitationsService(em, eventAccessService);
}

describe('EventInvitationsService', () => {
  describe('create', () => {
    it('creates an invitation for an existing user', async () => {
      const { em } = buildMockEm({ userResult: { id: 'invitee-1' } as never });
      const service = buildService(em);

      const result = await service.create(
        'event-1',
        { userId: 'invitee-1' },
        ACTOR,
      );

      expect(result.invitedUserId).toBe('invitee-1');
      expect(result.status).toBe(EventInvitationStatus.PENDING);
    });

    it('throws USER_NOT_FOUND when userId does not resolve', async () => {
      const { em } = buildMockEm({ userResult: null });
      const service = buildService(em);

      await expect(
        service.create('event-1', { userId: 'missing' }, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects creating an invitation once the event is %s',
      async (status) => {
        const { em } = buildMockEm({
          userResult: { id: 'invitee-1' } as never,
        });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.create('event-1', { userId: 'invitee-1' }, ACTOR),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it.each([EventStatus.DRAFT, EventStatus.PUBLISHED])(
      'allows creating an invitation while the event is %s',
      async (status) => {
        const { em } = buildMockEm({
          userResult: { id: 'invitee-1' } as never,
        });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.create('event-1', { userId: 'invitee-1' }, ACTOR),
        ).resolves.toMatchObject({ invitedUserId: 'invitee-1' });
      },
    );
  });

  describe('cancel', () => {
    it('cancels a pending invitation', async () => {
      const invitation = buildInvitation();
      const { em } = buildMockEm({ invitationResult: invitation });
      const service = buildService(em);

      await service.cancel('event-1', 'invitation-1');

      expect(invitation.status).toBe(EventInvitationStatus.CANCELLED);
    });

    it('throws EVENT_INVITATION_NOT_FOUND when the invitation does not exist', async () => {
      const { em } = buildMockEm({ invitationResult: null });
      const service = buildService(em);

      await expect(service.cancel('event-1', 'missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects cancelling an invitation once the event is %s',
      async (status) => {
        const invitation = buildInvitation();
        const { em } = buildMockEm({ invitationResult: invitation });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.cancel('event-1', 'invitation-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });

  describe('decline', () => {
    it('lets the invitee decline a pending invitation', async () => {
      const invitation = buildInvitation({
        invitedUser: { id: 'actor-1' } as never,
      });
      const { em } = buildMockEm({ invitationResult: invitation });
      const service = buildService(em);

      await service.decline('event-1', 'invitation-1', ACTOR);

      expect(invitation.status).toBe(EventInvitationStatus.DECLINED);
    });

    it('rejects a decline from someone other than the invitee', async () => {
      const invitation = buildInvitation({
        invitedUser: { id: 'someone-else' } as never,
      });
      const { em } = buildMockEm({ invitationResult: invitation });
      const service = buildService(em);

      await expect(
        service.decline('event-1', 'invitation-1', ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects declining an invitation once the event is %s',
      async (status) => {
        const invitation = buildInvitation({
          invitedUser: { id: 'actor-1' } as never,
        });
        const { em } = buildMockEm({ invitationResult: invitation });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.decline('event-1', 'invitation-1', ACTOR),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });
});
