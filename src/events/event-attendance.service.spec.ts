import { ConflictException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { UserCheckInIdentityService } from '../common/identity/user-check-in-identity.service';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { Group } from '../groups/entities/group.entity';
import { User } from '../users/entities/user.entity';
import { EventAttendanceService } from './event-attendance.service';
import { EventAccessService } from './event-access.service';
import { EventAttendee } from './entities/event-attendee.entity';
import { EventGuardianAssignment } from './entities/event-guardian-assignment.entity';
import { Event } from './entities/event.entity';
import { EventAttendeeSubjectType } from './enums/event-attendee-subject-type.enum';
import { EventCheckInMethod } from './enums/event-check-in-method.enum';
import { EventRsvpStatus } from './enums/event-rsvp-status.enum';
import { EventStatus } from './enums/event-status.enum';
import { EventType } from './enums/event-type.enum';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'attendee-user-1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada';
  user.apelido = 'Ada';
  return Object.assign(user, overrides);
}

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.name = 'Roda Grande';
  event.type = EventType.FESTIVAL;
  event.status = EventStatus.PUBLISHED;
  event.startsAt = new Date(Date.now() - 60 * 60_000);
  event.endsAt = new Date(Date.now() + 60 * 60_000);
  const group = new Group();
  group.id = 'group-1';
  event.communityGroup = group;
  event.communitySection = null;
  return Object.assign(event, overrides);
}

function buildAttendee(overrides: Partial<EventAttendee> = {}): EventAttendee {
  const attendee = new EventAttendee();
  attendee.id = 'attendee-1';
  attendee.subjectType = EventAttendeeSubjectType.SELF;
  attendee.subjectUser = buildUser();
  attendee.rsvpStatus = EventRsvpStatus.GOING;
  attendee.checkedIn = false;
  attendee.checkedInAt = null;
  attendee.checkedInBy = null;
  attendee.checkInMethod = null;
  return Object.assign(attendee, overrides);
}

function buildChildAttendee(
  overrides: Partial<EventAttendee> = {},
): EventAttendee {
  const attendee = new EventAttendee();
  attendee.id = 'child-attendee-1';
  attendee.subjectType = EventAttendeeSubjectType.CHILD_DEPENDENT;
  attendee.subjectUser = null;
  attendee.dependentDisplayName = 'Ania Kowalska';
  attendee.rsvpStatus = EventRsvpStatus.GOING;
  attendee.checkedIn = false;
  attendee.checkedInAt = null;
  attendee.checkedInBy = null;
  attendee.checkInMethod = null;
  return Object.assign(attendee, overrides);
}

function buildGuardianAssignment(
  overrides: Partial<EventGuardianAssignment> = {},
): EventGuardianAssignment {
  const assignment = new EventGuardianAssignment();
  assignment.id = 'guardian-assignment-1';
  assignment.attendee = buildChildAttendee();
  assignment.guardian = buildUser();
  assignment.revokedAt = null;
  return Object.assign(assignment, overrides);
}

interface MockRouting {
  attendee?: EventAttendee | null;
  rosterAttendees?: EventAttendee[];
  guardianAssignments?: EventGuardianAssignment[];
}

function buildMockEm(routing: MockRouting = {}): {
  em: EntityManager;
  flush: jest.Mock;
} {
  const findOne = jest.fn((entityClass: unknown) => {
    if (entityClass === EventAttendee) {
      return Promise.resolve(
        routing.attendee === undefined ? null : routing.attendee,
      );
    }
    return Promise.resolve(null);
  });
  const find = jest.fn((entityClass: unknown) => {
    if (entityClass === EventAttendee) {
      return Promise.resolve(routing.rosterAttendees ?? []);
    }
    if (entityClass === EventGuardianAssignment) {
      return Promise.resolve(routing.guardianAssignments ?? []);
    }
    return Promise.resolve([]);
  });
  const flush = jest.fn().mockResolvedValue(undefined);
  const em = { findOne, find, flush } as unknown as EntityManager;
  (em as unknown as { transactional: jest.Mock }).transactional = jest
    .fn()
    .mockImplementation((cb: (em: EntityManager) => unknown) => cb(em));
  return { em, flush };
}

function buildServices(
  overrides: {
    em?: EntityManager;
    event?: Event | null;
    attendee?: EventAttendee | null;
    rosterAttendees?: EventAttendee[];
    guardianAssignments?: EventGuardianAssignment[];
    resolvedUser?: User;
    resolvedMethod?: 'QR' | 'MANUAL';
  } = {},
) {
  const built = overrides.em
    ? { em: overrides.em, flush: undefined }
    : buildMockEm({
        attendee: overrides.attendee,
        rosterAttendees: overrides.rosterAttendees,
        guardianAssignments: overrides.guardianAssignments,
      });
  const em = built.em;

  const eventAccessService = {
    loadOrFail: jest
      .fn()
      .mockResolvedValue(
        overrides.event === undefined ? buildEvent() : overrides.event,
      ),
  } as unknown as EventAccessService;

  const resolve = jest.fn().mockResolvedValue({
    user: overrides.resolvedUser ?? buildUser(),
    method: overrides.resolvedMethod ?? 'MANUAL',
  });
  const userCheckInIdentityService = {
    resolve,
  } as unknown as UserCheckInIdentityService;

  const record = jest.fn();
  const auditLogService = { record } as unknown as AuditLogService;

  const service = new EventAttendanceService(
    em,
    eventAccessService,
    userCheckInIdentityService,
    auditLogService,
  );
  return {
    service,
    em,
    flush: built.flush,
    eventAccessService,
    userCheckInIdentityService,
    auditLogService,
    resolve,
    record,
  };
}

describe('EventAttendanceService.listRoster', () => {
  it('maps attendees to the slim roster shape, including attendeeId, safe user refs only', async () => {
    const attendee = buildAttendee({
      checkedIn: true,
      checkedInAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const { service } = buildServices({ rosterAttendees: [attendee] });

    const roster = await service.listRoster('event-1');

    expect(roster.event).toEqual({ id: 'event-1', name: 'Roda Grande' });
    expect(roster.items).toHaveLength(1);
    expect(roster.items[0]).toEqual({
      attendeeId: 'attendee-1',
      user: { id: 'attendee-user-1', displayName: 'Ada' },
      rsvpStatus: EventRsvpStatus.GOING,
      attended: true,
      recordedAt: '2026-01-01T00:00:00.000Z',
    });
  });

  it('includes a CHILD_DEPENDENT attendee with a null user.id but a real attendeeId', async () => {
    const child = buildChildAttendee();
    const { service } = buildServices({ rosterAttendees: [child] });

    const roster = await service.listRoster('event-1');

    expect(roster.items[0]).toEqual({
      attendeeId: 'child-attendee-1',
      user: { id: null, displayName: 'Ania Kowalska' },
      rsvpStatus: EventRsvpStatus.GOING,
      attended: false,
      recordedAt: null,
    });
  });
});

describe('EventAttendanceService.identifyByIdentity', () => {
  it('returns selfAttendee for a plain attendee with no children', async () => {
    const attendee = buildAttendee();
    const { service } = buildServices({ attendee });

    const result = await service.identifyByIdentity('event-1', '042981');

    expect(result.user).toEqual({
      id: 'attendee-user-1',
      displayName: 'Ada',
    });
    expect(result.selfAttendee?.attendeeId).toBe('attendee-1');
    expect(result.childrenUnderGuardianship).toEqual([]);
  });

  it('returns selfAttendee plus one child under guardianship', async () => {
    const attendee = buildAttendee();
    const child = buildGuardianAssignment();
    const { service } = buildServices({
      attendee,
      guardianAssignments: [child],
    });

    const result = await service.identifyByIdentity('event-1', '042981');

    expect(result.selfAttendee?.attendeeId).toBe('attendee-1');
    expect(result.childrenUnderGuardianship).toHaveLength(1);
    expect(result.childrenUnderGuardianship[0]).toEqual({
      attendeeId: 'child-attendee-1',
      user: { id: null, displayName: 'Ania Kowalska' },
      rsvpStatus: EventRsvpStatus.GOING,
      attended: false,
      recordedAt: null,
    });
  });

  it('returns selfAttendee plus several children under guardianship', async () => {
    const attendee = buildAttendee();
    const childA = buildGuardianAssignment({
      id: 'guardian-assignment-a',
      attendee: buildChildAttendee({
        id: 'child-a',
        dependentDisplayName: 'Ania Kowalska',
      }),
    });
    const childB = buildGuardianAssignment({
      id: 'guardian-assignment-b',
      attendee: buildChildAttendee({
        id: 'child-b',
        dependentDisplayName: 'Tomek Kowalski',
      }),
    });
    const { service } = buildServices({
      attendee,
      guardianAssignments: [childA, childB],
    });

    const result = await service.identifyByIdentity('event-1', '042981');

    expect(result.childrenUnderGuardianship.map((c) => c.attendeeId)).toEqual([
      'child-a',
      'child-b',
    ]);
  });

  it('returns selfAttendee=null and the children when the guardian is not themselves an attendee', async () => {
    const child = buildGuardianAssignment();
    const { service } = buildServices({
      attendee: null,
      guardianAssignments: [child],
    });

    const result = await service.identifyByIdentity('event-1', '042981');

    expect(result.selfAttendee).toBeNull();
    expect(result.childrenUnderGuardianship).toHaveLength(1);
  });

  it('throws EVENT_ATTENDEE_NOT_FOUND when neither a selfAttendee nor any children exist', async () => {
    const { service } = buildServices({
      attendee: null,
      guardianAssignments: [],
    });

    await expect(
      service.identifyByIdentity('event-1', '042981'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('never mutates checkedIn/checkedInAt - identify is a pure lookup', async () => {
    const attendee = buildAttendee();
    const child = buildGuardianAssignment();
    const { service, flush } = buildServices({
      attendee,
      guardianAssignments: [child],
    });

    await service.identifyByIdentity('event-1', '042981');

    expect(attendee.checkedIn).toBe(false);
    expect(attendee.checkedInAt).toBeNull();
    expect(child.attendee.checkedIn).toBe(false);
    expect(flush).not.toHaveBeenCalled();
  });

  it('rejects before the event has started, same rule as check-in', async () => {
    const attendee = buildAttendee();
    const futureEvent = buildEvent({
      startsAt: new Date(Date.now() + 60 * 60_000),
    });
    const { service } = buildServices({ attendee, event: futureEvent });

    await expect(
      service.identifyByIdentity('event-1', '042981'),
    ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_STARTED' } });
  });

  it('rejects for a CANCELLED event', async () => {
    const attendee = buildAttendee();
    const cancelledEvent = buildEvent({ status: EventStatus.CANCELLED });
    const { service } = buildServices({ attendee, event: cancelledEvent });

    await expect(
      service.identifyByIdentity('event-1', '042981'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('EventAttendanceService.recordAttendance', () => {
  it('marks an attendee present and audit-logs the change', async () => {
    const attendee = buildAttendee();
    const { service, record } = buildServices({ attendee });

    const result = await service.recordAttendance(
      'event-1',
      'attendee-user-1',
      true,
      buildUser({ id: 'actor-1' }),
    );

    expect(result.attended).toBe(true);
    expect(attendee.checkInMethod).toBe(EventCheckInMethod.MANUAL);
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.RECORD_EVENT_ATTENDANCE,
        targetType: AuditTargetType.USER,
        targetId: 'attendee-user-1',
        metadata: {
          eventId: 'event-1',
          attendeeId: 'attendee-1',
          attended: true,
        },
      }),
    );
  });

  it('does not audit-log when the value does not actually change', async () => {
    const attendee = buildAttendee({
      checkedIn: true,
      checkedInAt: new Date(),
    });
    const { service, record } = buildServices({ attendee });

    await service.recordAttendance(
      'event-1',
      'attendee-user-1',
      true,
      buildUser({ id: 'actor-1' }),
    );

    expect(record).not.toHaveBeenCalled();
  });

  it('throws EVENT_ATTENDEE_NOT_FOUND when the user never registered', async () => {
    const { service } = buildServices({ attendee: null });

    await expect(
      service.recordAttendance('event-1', 'stranger-1', true, buildUser()),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects before the event has started', async () => {
    const attendee = buildAttendee();
    const futureEvent = buildEvent({
      startsAt: new Date(Date.now() + 60 * 60_000),
    });
    const { service } = buildServices({ attendee, event: futureEvent });

    await expect(
      service.recordAttendance('event-1', 'attendee-user-1', true, buildUser()),
    ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_STARTED' } });
  });

  it('rejects for a CANCELLED event', async () => {
    const attendee = buildAttendee();
    const cancelledEvent = buildEvent({ status: EventStatus.CANCELLED });
    const { service } = buildServices({ attendee, event: cancelledEvent });

    await expect(
      service.recordAttendance('event-1', 'attendee-user-1', true, buildUser()),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('EventAttendanceService.recordAttendanceByAttendeeId', () => {
  it('marks a CHILD_DEPENDENT attendee present via attendeeId, with no User target on the audit entry', async () => {
    const child = buildChildAttendee();
    const { service, record } = buildServices({ attendee: child });

    const result = await service.recordAttendanceByAttendeeId(
      'event-1',
      'child-attendee-1',
      true,
      buildUser({ id: 'actor-1' }),
    );

    expect(result.attended).toBe(true);
    expect(result.user).toEqual({ id: null, displayName: 'Ania Kowalska' });
    expect(record).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: AuditAction.RECORD_EVENT_ATTENDANCE,
        targetType: undefined,
        targetId: undefined,
        metadata: {
          eventId: 'event-1',
          attendeeId: 'child-attendee-1',
          attended: true,
        },
      }),
    );
  });

  it('marks a CHILD_DEPENDENT attendee explicitly absent (false), then back to true', async () => {
    const child = buildChildAttendee();
    const { service } = buildServices({ attendee: child });

    const absent = await service.recordAttendanceByAttendeeId(
      'event-1',
      'child-attendee-1',
      false,
      buildUser({ id: 'actor-1' }),
    );
    expect(absent.attended).toBe(false);
    expect(absent.recordedAt).not.toBeNull();

    child.checkedIn = false;
    const present = await service.recordAttendanceByAttendeeId(
      'event-1',
      'child-attendee-1',
      true,
      buildUser({ id: 'actor-1' }),
    );
    expect(present.attended).toBe(true);
  });

  it('works for an ordinary (non-child) attendee too, addressed by attendeeId', async () => {
    const attendee = buildAttendee();
    const { service } = buildServices({ attendee });

    const result = await service.recordAttendanceByAttendeeId(
      'event-1',
      'attendee-1',
      true,
      buildUser({ id: 'actor-1' }),
    );

    expect(result.attended).toBe(true);
    expect(result.user.id).toBe('attendee-user-1');
  });

  it('throws EVENT_ATTENDEE_NOT_FOUND for an unknown attendeeId', async () => {
    const { service } = buildServices({ attendee: null });

    await expect(
      service.recordAttendanceByAttendeeId(
        'event-1',
        'missing-attendee',
        true,
        buildUser(),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('EventAttendanceService.checkInByIdentity', () => {
  it('resolves identity, marks present, and reports alreadyCheckedIn=false on first scan', async () => {
    const attendee = buildAttendee();
    const resolvedUser = buildUser({ id: 'attendee-user-1' });
    const { service, resolve } = buildServices({
      attendee,
      resolvedUser,
      resolvedMethod: 'QR',
    });

    const result = await service.checkInByIdentity(
      'event-1',
      'https://capohub.test/u/042981',
      buildUser({ id: 'actor-1' }),
    );

    expect(resolve).toHaveBeenCalledWith(
      'https://capohub.test/u/042981',
      expect.anything(),
    );
    expect(result.attended).toBe(true);
    expect(result.alreadyCheckedIn).toBe(false);
    expect(attendee.checkInMethod).toBe(EventCheckInMethod.QR);
  });

  it('only checks in the scanned self attendee - never any child under their guardianship', async () => {
    const attendee = buildAttendee();
    const child = buildGuardianAssignment();
    const { service } = buildServices({
      attendee,
      guardianAssignments: [child],
    });

    await service.checkInByIdentity(
      'event-1',
      '042981',
      buildUser({ id: 'actor-1' }),
    );

    expect(attendee.checkedIn).toBe(true);
    expect(child.attendee.checkedIn).toBe(false);
  });

  it('is idempotent - a second scan changes nothing and reports alreadyCheckedIn=true', async () => {
    const attendee = buildAttendee({
      checkedIn: true,
      checkedInAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    const { service, record } = buildServices({ attendee });

    const result = await service.checkInByIdentity(
      'event-1',
      '042981',
      buildUser({ id: 'actor-1' }),
    );

    expect(result.alreadyCheckedIn).toBe(true);
    expect(result.recordedAt).toBe('2026-01-01T00:00:00.000Z');
    expect(record).not.toHaveBeenCalled();
  });

  it('never creates an EventAttendee - rejects a user with no existing registration', async () => {
    // The mock EntityManager deliberately has no `persist` stub - if
    // checkInByIdentity ever called em.persist(new EventAttendee()) to
    // auto-register the scanned user, this test would fail with a
    // "persist is not a function" TypeError instead of the expected 404.
    const { service } = buildServices({ attendee: null });

    await expect(
      service.checkInByIdentity(
        'event-1',
        '042981',
        buildUser({ id: 'actor-1' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects a guardian with no self attendee - never guesses which child to check in', async () => {
    const child = buildGuardianAssignment();
    const { service } = buildServices({
      attendee: null,
      guardianAssignments: [child],
    });

    await expect(
      service.checkInByIdentity(
        'event-1',
        '042981',
        buildUser({ id: 'actor-1' }),
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(child.attendee.checkedIn).toBe(false);
  });

  it('rejects before the event has started', async () => {
    const attendee = buildAttendee();
    const futureEvent = buildEvent({
      startsAt: new Date(Date.now() + 60 * 60_000),
    });
    const { service } = buildServices({ attendee, event: futureEvent });

    await expect(
      service.checkInByIdentity(
        'event-1',
        '042981',
        buildUser({ id: 'actor-1' }),
      ),
    ).rejects.toMatchObject({ response: { code: 'EVENT_NOT_STARTED' } });
  });

  it('rejects for a CANCELLED event', async () => {
    const attendee = buildAttendee();
    const cancelledEvent = buildEvent({ status: EventStatus.CANCELLED });
    const { service } = buildServices({ attendee, event: cancelledEvent });

    await expect(
      service.checkInByIdentity(
        'event-1',
        '042981',
        buildUser({ id: 'actor-1' }),
      ),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
