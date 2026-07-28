import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { Event } from './entities/event.entity';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { EventCheckInMethod } from './enums/event-check-in-method.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventCheckInService } from './event-checkin.service';
import { User } from '../users/entities/user.entity';

const ACTOR = { id: 'actor-1', displayName: 'Actor' } as never;

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.status = EventStatus.PUBLISHED;
  return Object.assign(event, overrides);
}

function buildAttendee(overrides: Partial<EventAttendee> = {}): EventAttendee {
  const attendee = new EventAttendee();
  attendee.id = 'attendee-1';
  attendee.event = buildEvent();
  attendee.registeredBy = ACTOR;
  attendee.subjectType = EventAttendeeSubjectType.SELF;
  attendee.subjectUser = ACTOR;
  attendee.checkedIn = false;
  return Object.assign(attendee, overrides);
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'scanned-user-1';
  user.displayName = 'Scanned Person';
  user.publicCode = 'ABCD-1234';
  return Object.assign(user, overrides);
}

interface MockRouting {
  scannedUser?: User | null;
  selfAttendee?: EventAttendee | null;
  attendeeById?: EventAttendee | null;
  guardianAssignments?: EventGuardianAssignment[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);

  const findOne = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    if (entity === User) {
      return Promise.resolve(
        routing.scannedUser === undefined ? null : routing.scannedUser,
      );
    }
    if (entity === EventAttendee) {
      if ('id' in where) {
        return Promise.resolve(routing.attendeeById ?? null);
      }
      return Promise.resolve(routing.selfAttendee ?? null);
    }
    throw new Error(`Unexpected findOne entity: ${String(entity)}`);
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === EventGuardianAssignment) {
      return Promise.resolve(routing.guardianAssignments ?? []);
    }
    throw new Error(`Unexpected find entity: ${String(entity)}`);
  });

  const raw = {
    findOne,
    find,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, findOne, find };
}

function buildService(em: EntityManager, event: Event = buildEvent()) {
  const eventAccessService = {
    loadOrFail: jest.fn().mockResolvedValue(event),
  } as unknown as EventAccessService;

  return new EventCheckInService(em, eventAccessService);
}

describe('EventCheckInService', () => {
  describe('identify', () => {
    it('throws CHECK_IN_CODE_NOT_FOUND when no user matches the code', async () => {
      const { em } = buildMockEm({ scannedUser: null });
      const service = buildService(em);

      await expect(
        service.identify('event-1', 'ABCD-1234'),
      ).rejects.toMatchObject({
        response: { code: 'CHECK_IN_CODE_NOT_FOUND' },
      });
    });

    it('resolves the scanned user, their own registration, and guarded children', async () => {
      const scannedUser = buildUser();
      const selfAttendee = buildAttendee({
        subjectUser: scannedUser,
        registeredBy: scannedUser,
      });
      const childAttendee = buildAttendee({
        id: 'attendee-child',
        subjectType: EventAttendeeSubjectType.CHILD_DEPENDENT,
        subjectUser: null,
        dependentDisplayName: 'Kid',
      });
      const guardianAssignment = new EventGuardianAssignment();
      guardianAssignment.attendee = childAttendee;
      guardianAssignment.guardian = scannedUser;

      const { em } = buildMockEm({
        scannedUser,
        selfAttendee,
        guardianAssignments: [guardianAssignment],
      });
      const service = buildService(em);

      const result = await service.identify('event-1', 'ABCD-1234');

      expect(result.user.id).toBe(scannedUser.id);
      expect(result.selfAttendee?.id).toBe(selfAttendee.id);
      expect(result.childrenUnderGuardianship).toHaveLength(1);
      expect(result.childrenUnderGuardianship[0].id).toBe('attendee-child');
    });

    it('rejects identification while the event is DRAFT', async () => {
      const { em } = buildMockEm({ scannedUser: buildUser() });
      const service = buildService(
        em,
        buildEvent({ status: EventStatus.DRAFT }),
      );

      await expect(
        service.identify('event-1', 'ABCD-1234'),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_DRAFT' },
      });
    });

    it('allows identification while the event has lazily FINISHED', async () => {
      const { em } = buildMockEm({ scannedUser: buildUser() });
      const service = buildService(
        em,
        buildEvent({ status: EventStatus.FINISHED }),
      );

      await expect(
        service.identify('event-1', 'ABCD-1234'),
      ).resolves.toBeDefined();
    });
  });

  describe('markPresent', () => {
    it('marks an attendee present with the given method', async () => {
      const attendee = buildAttendee({ checkedIn: false });
      const { em } = buildMockEm({ attendeeById: attendee });
      const service = buildService(em);

      const result = await service.markPresent(
        'event-1',
        'attendee-1',
        EventCheckInMethod.QR,
        ACTOR,
      );

      expect(result.checkedIn).toBe(true);
      expect(result.checkInMethod).toBe(EventCheckInMethod.QR);
    });

    it('rejects marking an already-checked-in attendee again', async () => {
      const attendee = buildAttendee({ checkedIn: true });
      const { em } = buildMockEm({ attendeeById: attendee });
      const service = buildService(em);

      await expect(
        service.markPresent(
          'event-1',
          'attendee-1',
          EventCheckInMethod.MANUAL,
          ACTOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'ATTENDEE_ALREADY_CHECKED_IN' },
      });
    });

    it('throws EVENT_ATTENDEE_NOT_FOUND for an unknown attendee', async () => {
      const { em } = buildMockEm({ attendeeById: null });
      const service = buildService(em);

      await expect(
        service.markPresent(
          'event-1',
          'missing',
          EventCheckInMethod.MANUAL,
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('undoCheckIn', () => {
    it('reverses a check-in', async () => {
      const attendee = buildAttendee({
        checkedIn: true,
        checkedInAt: new Date(),
        checkedInBy: ACTOR,
        checkInMethod: EventCheckInMethod.MANUAL,
      });
      const { em } = buildMockEm({ attendeeById: attendee });
      const service = buildService(em);

      const result = await service.undoCheckIn('event-1', 'attendee-1');

      expect(result.checkedIn).toBe(false);
      expect(result.checkInMethod).toBeNull();
    });

    it('rejects undoing a check-in that never happened', async () => {
      const attendee = buildAttendee({ checkedIn: false });
      const { em } = buildMockEm({ attendeeById: attendee });
      const service = buildService(em);

      await expect(
        service.undoCheckIn('event-1', 'attendee-1'),
      ).rejects.toMatchObject({
        response: { code: 'ATTENDEE_NOT_CHECKED_IN' },
      });
    });
  });
});
