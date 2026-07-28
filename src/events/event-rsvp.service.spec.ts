import { ConflictException, ForbiddenException } from '@nestjs/common';
import { LockMode } from '@mikro-orm/postgresql';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from './event-access.service';
import { ChildrenDirectoryPort } from './integration/children-directory.port';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { Event } from './entities/event.entity';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { EventRsvpStatus } from './enums/event-rsvp-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventWaitlistPolicy } from './enums/event-waitlist-policy.enum';
import { EventRsvpService } from './event-rsvp.service';
import { RegisterForEventInput } from './dto/register-for-event.schema';

const ACTOR = {
  id: 'actor-1',
  displayName: 'Actor',
  email: 'actor@example.com',
} as never;

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.status = EventStatus.PUBLISHED;
  event.capacity = null;
  event.waitlistPolicy = EventWaitlistPolicy.NONE;
  return Object.assign(event, overrides);
}

function buildAttendee(overrides: Partial<EventAttendee> = {}): EventAttendee {
  const attendee = new EventAttendee();
  attendee.id = 'attendee-1';
  attendee.event = buildEvent();
  attendee.registeredBy = ACTOR;
  attendee.subjectType = EventAttendeeSubjectType.SELF;
  attendee.subjectUser = ACTOR;
  attendee.rsvpStatus = EventRsvpStatus.GOING;
  attendee.isWaitlisted = false;
  return Object.assign(attendee, overrides);
}

function buildRegisterInput(
  overrides: Partial<RegisterForEventInput> = {},
): RegisterForEventInput {
  return {
    attendSelf: true,
    selfRsvpStatus: EventRsvpStatus.GOING,
    children: [],
    ...overrides,
  };
}

interface MockRouting {
  event?: Event;
  eligible?: boolean;
  existingAttendeeQueue?: (EventAttendee | null)[];
  attendeeByIdResult?: EventAttendee | null;
  seatsTakenQueue?: number[];
  existingGuardianQueue?: (EventGuardianAssignment | null)[];
  nextWaitlisted?: EventAttendee | null;
  guardianAssignmentsForResponse?: EventGuardianAssignment[];
  childrenDirectoryAllows?: boolean;
}

function buildMockEm(routing: MockRouting = {}) {
  const existingAttendeeQueue = [...(routing.existingAttendeeQueue ?? [])];
  const seatsTakenQueue = [...(routing.seatsTakenQueue ?? [0])];
  const existingGuardianQueue = [...(routing.existingGuardianQueue ?? [null])];

  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [EventAttendee | EventGuardianAssignment]>()
    .mockReturnValue({ flush });
  const getReference = jest.fn((_entity: unknown, id: string) => ({ id }));

  const findOne = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    if (entity === EventAttendee) {
      if ('id' in where) {
        return Promise.resolve(routing.attendeeByIdResult ?? null);
      }
      if ('isWaitlisted' in where) {
        return Promise.resolve(routing.nextWaitlisted ?? null);
      }
      return Promise.resolve(existingAttendeeQueue.shift() ?? null);
    }
    if (entity === EventGuardianAssignment) {
      return Promise.resolve(existingGuardianQueue.shift() ?? null);
    }
    throw new Error(`Unexpected findOne entity: ${String(entity)}`);
  });

  const count = jest.fn((entity: unknown) => {
    if (entity === EventAttendee) {
      return Promise.resolve(seatsTakenQueue.shift() ?? 0);
    }
    throw new Error(`Unexpected count entity: ${String(entity)}`);
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === EventGuardianAssignment) {
      return Promise.resolve(routing.guardianAssignmentsForResponse ?? []);
    }
    throw new Error(`Unexpected find entity: ${String(entity)}`);
  });

  const lock = jest.fn().mockResolvedValue(undefined);

  const raw = {
    findOne,
    find,
    count,
    persist,
    flush,
    getReference,
    lock,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return {
    em: raw as unknown as EntityManager,
    persist,
    findOne,
    find,
    count,
    lock,
  };
}

function buildService(em: EntityManager, routing: MockRouting = {}) {
  const event = routing.event ?? buildEvent();
  const eventAccessService = {
    loadOrFail: jest.fn().mockResolvedValue(event),
    canViewerRegister: jest.fn().mockResolvedValue(routing.eligible ?? true),
    findActiveInvitation: jest.fn().mockResolvedValue(null),
  } as unknown as EventAccessService;
  const childrenDirectoryPort = {
    canRegisterChildAccount: jest
      .fn()
      .mockResolvedValue(routing.childrenDirectoryAllows ?? false),
    listChildrenOf: jest.fn().mockResolvedValue([]),
  } as unknown as ChildrenDirectoryPort;

  return new EventRsvpService(em, eventAccessService, childrenDirectoryPort);
}

describe('EventRsvpService', () => {
  describe('register', () => {
    it('registers the caller with a seat when there is no capacity limit', async () => {
      const { em, persist } = buildMockEm({ existingAttendeeQueue: [null] });
      const service = buildService(em);

      const results = await service.register(
        'event-1',
        buildRegisterInput(),
        ACTOR,
      );

      expect(results).toHaveLength(1);
      expect(results[0].isWaitlisted).toBe(false);
      const attendee = persist.mock.calls[0][0] as EventAttendee;
      expect(attendee.subjectType).toBe(EventAttendeeSubjectType.SELF);
      expect(attendee.isWaitlisted).toBe(false);
    });

    it('waitlists a new registration when capacity is full and policy is AUTOMATIC', async () => {
      const { em } = buildMockEm({
        existingAttendeeQueue: [null],
        seatsTakenQueue: [5],
      });
      const event = buildEvent({
        capacity: 5,
        waitlistPolicy: EventWaitlistPolicy.AUTOMATIC,
      });
      const service = buildService(em, { event });

      const results = await service.register(
        'event-1',
        buildRegisterInput(),
        ACTOR,
      );

      expect(results[0].isWaitlisted).toBe(true);
    });

    it('rejects registration when capacity is full and there is no waitlist', async () => {
      const { em } = buildMockEm({
        existingAttendeeQueue: [null],
        seatsTakenQueue: [3],
      });
      const event = buildEvent({
        capacity: 3,
        waitlistPolicy: EventWaitlistPolicy.NONE,
      });
      const service = buildService(em, { event });

      await expect(
        service.register('event-1', buildRegisterInput(), ACTOR),
      ).rejects.toMatchObject({ response: { code: 'EVENT_FULL' } });
    });

    it('rejects registration when the caller is not visibility-eligible', async () => {
      const { em } = buildMockEm();
      const service = buildService(em, { eligible: false });

      await expect(
        service.register('event-1', buildRegisterInput(), ACTOR),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('rejects registration when the event is not PUBLISHED', async () => {
      const { em } = buildMockEm();
      const event = buildEvent({ status: EventStatus.DRAFT });
      const service = buildService(em, { event });

      await expect(
        service.register('event-1', buildRegisterInput(), ACTOR),
      ).rejects.toMatchObject({ response: { code: 'EVENT_DRAFT' } });
    });

    it('registers a CHILD_DEPENDENT and creates a guardian assignment', async () => {
      const { em, persist } = buildMockEm({
        existingAttendeeQueue: [null],
        existingGuardianQueue: [null],
      });
      const service = buildService(em);

      const results = await service.register(
        'event-1',
        buildRegisterInput({
          attendSelf: false,
          children: [
            { subjectType: 'CHILD_DEPENDENT', displayName: 'Little Timmy' },
          ],
        }),
        ACTOR,
      );

      expect(results).toHaveLength(1);
      const persistedEntities = persist.mock.calls.map((call) => call[0]);
      expect(
        persistedEntities.some((e) => e instanceof EventGuardianAssignment),
      ).toBe(true);
    });

    it('rejects a CHILD_ACCOUNT registration while the children directory is unavailable', async () => {
      const { em } = buildMockEm({ existingAttendeeQueue: [] });
      const service = buildService(em, { childrenDirectoryAllows: false });

      await expect(
        service.register(
          'event-1',
          buildRegisterInput({
            attendSelf: false,
            children: [
              { subjectType: 'CHILD_ACCOUNT', childUserId: 'child-1' },
            ],
          }),
          ACTOR,
        ),
      ).rejects.toMatchObject({
        response: { code: 'CHILDREN_DIRECTORY_NOT_AVAILABLE' },
      });
    });

    // Concurrency guard (see assignSeatOrWaitlist's own comment): capacity
    // enforcement is only race-free if the Event row is locked before the
    // seats-taken count runs. These tests can't reproduce the actual race
    // (the mocked EntityManager has no real transactions/locks) - see
    // events.e2e-spec.ts for a real-concurrency reproduction against
    // Postgres - but they do guard against silently losing the lock call
    // itself in a future refactor.
    it('locks the Event row before counting seats when a capacity limit is set', async () => {
      const { em, lock } = buildMockEm({
        existingAttendeeQueue: [null],
        seatsTakenQueue: [0],
      });
      const event = buildEvent({
        capacity: 5,
        waitlistPolicy: EventWaitlistPolicy.AUTOMATIC,
      });
      const service = buildService(em, { event });

      await service.register('event-1', buildRegisterInput(), ACTOR);

      expect(lock).toHaveBeenCalledWith(event, LockMode.PESSIMISTIC_WRITE);
    });

    it('does not lock the Event row when there is no capacity limit', async () => {
      const { em, lock } = buildMockEm({ existingAttendeeQueue: [null] });
      const service = buildService(em);

      await service.register('event-1', buildRegisterInput(), ACTOR);

      expect(lock).not.toHaveBeenCalled();
    });
  });

  describe('updateRsvp', () => {
    it("rejects changing another user's registration", async () => {
      const attendee = buildAttendee({
        registeredBy: { id: 'someone-else' } as never,
      });
      const { em } = buildMockEm();
      const service = buildService(em);
      (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

      await expect(
        service.updateRsvp(
          'event-1',
          'attendee-1',
          { rsvpStatus: EventRsvpStatus.MAYBE },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('frees a seat and triggers automatic promotion when moving to NOT_GOING', async () => {
      const attendee = buildAttendee({
        rsvpStatus: EventRsvpStatus.GOING,
        isWaitlisted: false,
      });
      const nextWaitlisted = buildAttendee({
        id: 'attendee-2',
        isWaitlisted: true,
        waitlistedAt: new Date(),
      });
      const event = buildEvent({
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.AUTOMATIC,
      });
      const { em } = buildMockEm({ nextWaitlisted });
      const service = buildService(em, { event });
      (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

      const result = await service.updateRsvp(
        'event-1',
        'attendee-1',
        { rsvpStatus: EventRsvpStatus.NOT_GOING },
        ACTOR,
      );

      expect(result.rsvpStatus).toBe(EventRsvpStatus.NOT_GOING);
      expect(nextWaitlisted.isWaitlisted).toBe(false);
      expect(nextWaitlisted.promotedAt).not.toBeNull();
    });

    it('allows switching between GOING and MAYBE while already seated, with no waitlist side effects', async () => {
      const attendee = buildAttendee({
        rsvpStatus: EventRsvpStatus.GOING,
        isWaitlisted: false,
      });
      const { em, count } = buildMockEm();
      const service = buildService(em);
      (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

      const result = await service.updateRsvp(
        'event-1',
        'attendee-1',
        { rsvpStatus: EventRsvpStatus.MAYBE },
        ACTOR,
      );

      expect(result.rsvpStatus).toBe(EventRsvpStatus.MAYBE);
      expect(count).not.toHaveBeenCalled();
    });
  });

  describe('promoteFromWaitlist', () => {
    it('rejects promotion when the waitlist policy is not MANUAL', async () => {
      const event = buildEvent({
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.AUTOMATIC,
      });
      const { em } = buildMockEm();
      const service = buildService(em, { event });

      await expect(
        service.promoteFromWaitlist('event-1', 'attendee-1'),
      ).rejects.toMatchObject({
        response: { code: 'EVENT_NOT_MANUAL_WAITLIST' },
      });
    });

    it('promotes a waitlisted attendee under MANUAL policy', async () => {
      const event = buildEvent({
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.MANUAL,
      });
      const attendee = buildAttendee({ isWaitlisted: true });
      const { em } = buildMockEm();
      const service = buildService(em, { event });
      (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

      const result = await service.promoteFromWaitlist('event-1', 'attendee-1');

      expect(result.isWaitlisted).toBe(false);
    });

    it('rejects promoting an attendee who is not waitlisted', async () => {
      const event = buildEvent({
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.MANUAL,
      });
      const attendee = buildAttendee({ isWaitlisted: false });
      const { em } = buildMockEm();
      const service = buildService(em, { event });
      (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

      await expect(
        service.promoteFromWaitlist('event-1', 'attendee-1'),
      ).rejects.toMatchObject({
        response: { code: 'ATTENDEE_NOT_WAITLISTED' },
      });
    });

    it('locks the Event row before promoting', async () => {
      const event = buildEvent({
        capacity: 1,
        waitlistPolicy: EventWaitlistPolicy.MANUAL,
      });
      const attendee = buildAttendee({ isWaitlisted: true });
      const { em, lock } = buildMockEm();
      const service = buildService(em, { event });
      (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

      await service.promoteFromWaitlist('event-1', 'attendee-1');

      expect(lock).toHaveBeenCalledWith(event, LockMode.PESSIMISTIC_WRITE);
    });

    it.each([EventStatus.FINISHED, EventStatus.CANCELLED])(
      'rejects manual promotion once the event is %s',
      async (status) => {
        const event = buildEvent({
          status,
          capacity: 1,
          waitlistPolicy: EventWaitlistPolicy.MANUAL,
        });
        const { em } = buildMockEm();
        const service = buildService(em, { event });

        await expect(
          service.promoteFromWaitlist('event-1', 'attendee-1'),
        ).rejects.toBeInstanceOf(ConflictException);
      },
    );

    it.each([EventStatus.DRAFT, EventStatus.PUBLISHED])(
      'allows manual promotion while the event is %s',
      async (status) => {
        const event = buildEvent({
          status,
          capacity: 1,
          waitlistPolicy: EventWaitlistPolicy.MANUAL,
        });
        const attendee = buildAttendee({ isWaitlisted: true });
        const { em } = buildMockEm();
        const service = buildService(em, { event });
        (em.findOne as jest.Mock).mockResolvedValueOnce(attendee);

        await expect(
          service.promoteFromWaitlist('event-1', 'attendee-1'),
        ).resolves.toMatchObject({ isWaitlisted: false });
      },
    );
  });
});
