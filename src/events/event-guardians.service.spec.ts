import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { Event } from './entities/event.entity';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventGuardiansService } from './event-guardians.service';

const ACTOR = { id: 'actor-1', displayName: 'Actor' } as never;

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  return Object.assign(event, overrides);
}

function buildAttendee(overrides: Partial<EventAttendee> = {}): EventAttendee {
  const attendee = new EventAttendee();
  attendee.id = 'attendee-1';
  attendee.event = buildEvent();
  attendee.subjectType = EventAttendeeSubjectType.CHILD_DEPENDENT;
  return Object.assign(attendee, overrides);
}

interface MockRouting {
  attendeeResult?: EventAttendee | null;
  userResult?: User | null;
  existingGuardianResult?: EventGuardianAssignment | null;
  guardianAssignmentResult?: EventGuardianAssignment | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown) => {
    if (entity === EventAttendee) {
      return Promise.resolve(
        routing.attendeeResult === undefined
          ? buildAttendee()
          : routing.attendeeResult,
      );
    }
    if (entity === User) {
      return Promise.resolve(routing.userResult ?? null);
    }
    if (entity === EventGuardianAssignment) {
      return Promise.resolve(
        routing.guardianAssignmentResult !== undefined
          ? routing.guardianAssignmentResult
          : (routing.existingGuardianResult ?? null),
      );
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

  return new EventGuardiansService(em, eventAccessService);
}

describe('EventGuardiansService', () => {
  describe('assign', () => {
    it('assigns a guardian to a child attendee', async () => {
      const { em } = buildMockEm({ userResult: { id: 'guardian-1' } as never });
      const service = buildService(em);

      const result = await service.assign(
        'event-1',
        'attendee-1',
        { guardianUserId: 'guardian-1' },
        ACTOR,
      );

      expect(result.guardianUserId).toBe('guardian-1');
    });

    it('rejects assigning a guardian to a SELF attendee', async () => {
      const { em } = buildMockEm({
        attendeeResult: buildAttendee({
          subjectType: EventAttendeeSubjectType.SELF,
        }),
        userResult: { id: 'guardian-1' } as never,
      });
      const service = buildService(em);

      await expect(
        service.assign(
          'event-1',
          'attendee-1',
          { guardianUserId: 'guardian-1' },
          ACTOR,
        ),
      ).rejects.toMatchObject({ response: { code: 'ATTENDEE_NOT_A_CHILD' } });
    });

    it('throws EVENT_ATTENDEE_NOT_FOUND when the attendee does not exist', async () => {
      const { em } = buildMockEm({ attendeeResult: null });
      const service = buildService(em);

      await expect(
        service.assign(
          'event-1',
          'missing',
          { guardianUserId: 'guardian-1' },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects assigning a guardian once the event is %s',
      async (status) => {
        const { em } = buildMockEm({
          userResult: { id: 'guardian-1' } as never,
        });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.assign(
            'event-1',
            'attendee-1',
            { guardianUserId: 'guardian-1' },
            ACTOR,
          ),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it.each([EventStatus.DRAFT, EventStatus.PUBLISHED])(
      'allows assigning a guardian while the event is %s',
      async (status) => {
        const { em } = buildMockEm({
          userResult: { id: 'guardian-1' } as never,
        });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.assign(
            'event-1',
            'attendee-1',
            { guardianUserId: 'guardian-1' },
            ACTOR,
          ),
        ).resolves.toMatchObject({ guardianUserId: 'guardian-1' });
      },
    );
  });

  describe('revoke', () => {
    it('revokes the active guardian assignment', async () => {
      const assignment = new EventGuardianAssignment();
      assignment.id = 'assignment-1';
      assignment.revokedAt = null;
      const { em } = buildMockEm({ guardianAssignmentResult: assignment });
      const service = buildService(em);

      await service.revoke('event-1', 'attendee-1');

      expect(assignment.revokedAt).not.toBeNull();
    });

    it('throws EVENT_GUARDIAN_ASSIGNMENT_NOT_FOUND when there is no active assignment', async () => {
      const { em } = buildMockEm({ guardianAssignmentResult: null });
      const service = buildService(em);

      await expect(
        service.revoke('event-1', 'attendee-1'),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects revoking a guardian once the event is %s',
      async (status) => {
        const assignment = new EventGuardianAssignment();
        assignment.id = 'assignment-1';
        const { em } = buildMockEm({ guardianAssignmentResult: assignment });
        const service = buildService(em, buildEvent({ status }));

        await expect(
          service.revoke('event-1', 'attendee-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );
  });
});
