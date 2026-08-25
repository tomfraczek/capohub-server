import { RequestContext } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import { Event } from '../events/entities/event.entity';
import { EventRsvpStatus } from '../events/enums/event-rsvp-status.enum';
import { EventStatus } from '../events/enums/event-status.enum';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { Training } from '../trainings/entities/training.entity';
import { TrainingRsvp } from '../trainings/entities/training-rsvp.entity';
import { TrainingRsvpStatus } from '../trainings/enums/training-rsvp-status.enum';
import { TrainingStatus } from '../trainings/enums/training-status.enum';
import { User } from '../users/entities/user.entity';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';
import { NotificationType } from './enums/notification-type.enum';
import { NotificationReminderScheduler } from './notification-reminder.scheduler';
import {
  CreateNotificationParams,
  NotificationsService,
} from './notifications.service';

function buildUser(id: string): User {
  const user = new User();
  user.id = id;
  return user;
}

function buildSection(id = 'section-1'): Section {
  const section = new Section();
  section.id = id;
  return section;
}

function buildTraining(): Training {
  const training = new Training();
  training.id = 'training-1';
  training.section = buildSection();
  training.status = TrainingStatus.SCHEDULED;
  training.startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  return training;
}

function buildMembership(userId: string): SectionMembership {
  const membership = new SectionMembership();
  membership.user = buildUser(userId);
  membership.status = SectionMembershipStatus.ACTIVE;
  return membership;
}

function buildTrainingRsvp(
  userId: string,
  status: TrainingRsvpStatus,
): TrainingRsvp {
  const rsvp = new TrainingRsvp();
  rsvp.user = buildUser(userId);
  rsvp.status = status;
  return rsvp;
}

function buildEvent(): Event {
  const event = new Event();
  event.id = 'event-1';
  event.name = 'Roda';
  event.status = EventStatus.PUBLISHED;
  event.startsAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  event.communityGroup = new Group();
  event.communityGroup.id = 'group-1';
  event.communitySection = null;
  return event;
}

function buildEventAttendee(
  userId: string,
  status: EventRsvpStatus,
): EventAttendee {
  const attendee = new EventAttendee();
  attendee.subjectUser = buildUser(userId);
  attendee.rsvpStatus = status;
  return attendee;
}

interface Routing {
  memberships?: SectionMembership[];
  trainingRsvps?: TrainingRsvp[];
  attendees?: EventAttendee[];
  disabledPreferenceUserIds?: string[];
}

function buildMockEm(routing: Routing = {}) {
  const training = buildTraining();
  const event = buildEvent();

  const find = jest.fn((entity: unknown) => {
    if (entity === Training) return Promise.resolve([training]);
    if (entity === Event) return Promise.resolve([event]);
    if (entity === SectionMembership)
      return Promise.resolve(routing.memberships ?? []);
    if (entity === TrainingRsvp)
      return Promise.resolve(routing.trainingRsvps ?? []);
    if (entity === EventAttendee) {
      // Mirrors the real query's own rsvpStatus IN (GOING, MAYBE) filter -
      // this mock has no real WHERE evaluation, so it's replicated here.
      const allowed: EventRsvpStatus[] = [
        EventRsvpStatus.GOING,
        EventRsvpStatus.MAYBE,
      ];
      return Promise.resolve(
        (routing.attendees ?? []).filter((a) => allowed.includes(a.rsvpStatus)),
      );
    }
    if (entity === UserNotificationPreferences) {
      const disabled = routing.disabledPreferenceUserIds ?? [];
      return Promise.resolve(
        disabled.map((userId) => {
          const preferences = new UserNotificationPreferences();
          preferences.user = buildUser(userId);
          preferences.trainingReminder24h = false;
          preferences.trainingReminder2h = false;
          preferences.eventReminder24h = false;
          preferences.eventReminder2h = false;
          return preferences;
        }),
      );
    }
    return Promise.resolve([]);
  });

  const getReference = jest.fn((_entity: unknown, id: string) => buildUser(id));

  const mockEm = buildMockEmBase({ find, getReference });

  return {
    em: mockEm,
    find,
    training,
    event,
  };
}

// `run()` is decorated with `@CreateRequestContext()` (see
// notification-reminder.scheduler.ts's own comment on why), whose
// auto-detection requires `this.em instanceof EntityManager` from
// `@mikro-orm/core` (see resolveContextProvider.js) - a plain object mock
// fails that check outright with "@CreateRequestContext() decorator can
// only be applied to methods of classes with `orm: MikroORM` property,
// `em: EntityManager` property...". `Object.create(EntityManager.prototype)`
// satisfies `instanceof` (SqlEntityManager - the concrete class this
// project injects everywhere, see user.service.ts etc. - extends core's
// EntityManager) while every method call still resolves to the jest.fn()
// stubs assigned as own properties, which shadow the real prototype
// methods. `.name`/`.fork()` are exercised for real by every test in this
// file, not stubbed away: `RequestContext.createContext(em)` reads
// `em.name` and calls `em.fork(...)` before `run()`'s own body ever
// executes - a mock missing either would fail every test with a
// TypeError before reaching any business logic, which is itself a
// meaningful regression signal for "the context-creation wiring broke".
function buildMockEmBase(methods: Record<string, jest.Mock>): EntityManager {
  const mockEm = Object.assign(Object.create(EntityManager.prototype), {
    name: 'default',
    ...methods,
  }) as EntityManager & Record<string, unknown>;
  mockEm.fork = jest.fn().mockReturnValue(mockEm);
  return mockEm;
}

function buildNotificationsService(): {
  service: NotificationsService;
  createMany: jest.Mock;
} {
  const createMany = jest.fn().mockResolvedValue([]);
  return {
    service: { createMany } as unknown as NotificationsService,
    createMany,
  };
}

function paramsFor(
  calls: [unknown, CreateNotificationParams[]][],
  type: NotificationType,
): CreateNotificationParams[] {
  const call = calls.find(([, params]) => params[0]?.type === type);
  return call ? call[1] : [];
}

describe('NotificationReminderScheduler', () => {
  it('reminds active Section members except those who RSVPd NO, plus external YES/MAYBE', async () => {
    const { em } = buildMockEm({
      memberships: [
        buildMembership('member-yes'),
        buildMembership('member-no'),
      ],
      trainingRsvps: [
        buildTrainingRsvp('member-no', TrainingRsvpStatus.NO),
        buildTrainingRsvp('external-yes', TrainingRsvpStatus.YES),
        buildTrainingRsvp('external-no-response', TrainingRsvpStatus.MAYBE),
      ],
    });
    const { service, createMany } = buildNotificationsService();
    const scheduler = new NotificationReminderScheduler(em, service);

    await scheduler.run();

    const calls = createMany.mock.calls as [
      unknown,
      CreateNotificationParams[],
    ][];
    const params = paramsFor(calls, NotificationType.TRAINING_REMINDER_24H);
    const recipientIds = params.map((p) => p.recipient.id).sort();

    expect(recipientIds).toEqual(
      ['external-yes', 'member-yes', 'external-no-response'].sort(),
    );
    expect(recipientIds).not.toContain('member-no');
  });

  it('sets a stable, per-recipient deduplication key for Training reminders', async () => {
    const { em } = buildMockEm({
      memberships: [buildMembership('member-1')],
    });
    const { service, createMany } = buildNotificationsService();
    const scheduler = new NotificationReminderScheduler(em, service);

    await scheduler.run();

    const calls = createMany.mock.calls as [
      unknown,
      CreateNotificationParams[],
    ][];
    const params24h = paramsFor(calls, NotificationType.TRAINING_REMINDER_24H);
    expect(params24h[0].deduplicationKey).toBe(
      'TRAINING_REMINDER_24H:training-1:member-1',
    );
    const params2h = paramsFor(calls, NotificationType.TRAINING_REMINDER_2H);
    expect(params2h[0].deduplicationKey).toBe(
      'TRAINING_REMINDER_2H:training-1:member-1',
    );
  });

  it('never creates a reminder for a recipient who disabled that specific reminder', async () => {
    const { em } = buildMockEm({
      memberships: [buildMembership('member-1')],
      disabledPreferenceUserIds: ['member-1'],
    });
    const { service, createMany } = buildNotificationsService();
    const scheduler = new NotificationReminderScheduler(em, service);

    await scheduler.run();

    const calls = createMany.mock.calls as [
      unknown,
      CreateNotificationParams[],
    ][];
    expect(paramsFor(calls, NotificationType.TRAINING_REMINDER_24H)).toEqual(
      [],
    );
    expect(paramsFor(calls, NotificationType.TRAINING_REMINDER_2H)).toEqual([]);
  });

  it('reminds Event attendees who RSVPd GOING/MAYBE, excludes NOT_GOING', async () => {
    const { em } = buildMockEm({
      attendees: [
        buildEventAttendee('going', EventRsvpStatus.GOING),
        buildEventAttendee('maybe', EventRsvpStatus.MAYBE),
        buildEventAttendee('declined', EventRsvpStatus.NOT_GOING),
      ],
    });
    const { service, createMany } = buildNotificationsService();
    const scheduler = new NotificationReminderScheduler(em, service);

    await scheduler.run();

    const calls = createMany.mock.calls as [
      unknown,
      CreateNotificationParams[],
    ][];
    const params = paramsFor(calls, NotificationType.EVENT_REMINDER_24H);
    const recipientIds = params.map((p) => p.recipient.id).sort();

    expect(recipientIds).toEqual(['going', 'maybe'].sort());
    expect(recipientIds).not.toContain('declined');
  });

  it('sets a stable, per-recipient deduplication key for Event reminders', async () => {
    const { em } = buildMockEm({
      attendees: [buildEventAttendee('attendee-1', EventRsvpStatus.GOING)],
    });
    const { service, createMany } = buildNotificationsService();
    const scheduler = new NotificationReminderScheduler(em, service);

    await scheduler.run();

    const calls = createMany.mock.calls as [
      unknown,
      CreateNotificationParams[],
    ][];
    const params24h = paramsFor(calls, NotificationType.EVENT_REMINDER_24H);
    expect(params24h[0].deduplicationKey).toBe(
      'EVENT_REMINDER_24H:event-1:attendee-1',
    );
  });

  it('a tick failure is caught and logged, never thrown to the caller', async () => {
    const em = buildMockEmBase({
      find: jest.fn().mockRejectedValue(new Error('db down')),
    });
    const { service } = buildNotificationsService();
    const scheduler = new NotificationReminderScheduler(em, service);

    await expect(scheduler.run()).resolves.toBeUndefined();
  });

  // Regression test for the exact production bug this module's own
  // @CreateRequestContext() comment describes: without it, every tick
  // used the raw global EntityManager and crashed with "Using global
  // EntityManager instance methods for context specific actions is
  // disallowed" (allowGlobalContext: false - see
  // mikro-orm-options.factory.ts). This test would fail (contextDuringRun
  // stays undefined) if that decorator were ever removed.
  it('runs inside a MikroORM RequestContext', async () => {
    const { em } = buildMockEm({
      memberships: [buildMembership('member-1')],
    });
    const { service, createMany } = buildNotificationsService();
    let contextDuringRun: RequestContext | undefined;
    createMany.mockImplementation(() => {
      contextDuringRun = RequestContext.currentRequestContext();
      return Promise.resolve([]);
    });
    const scheduler = new NotificationReminderScheduler(em, service);

    await scheduler.run();

    expect(createMany).toHaveBeenCalled();
    expect(contextDuringRun).toBeDefined();
  });
});
