import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { CreateRequestContext } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import { Event } from '../events/entities/event.entity';
import { eventCommunity } from '../events/event-community.util';
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
import { CreateNotificationParams } from './notifications.service';
import { UserNotificationPreferences } from './entities/user-notification-preferences.entity';
import { NotificationCategory } from './enums/notification-category.enum';
import { NotificationTargetType } from './enums/notification-target-type.enum';
import { NotificationType } from './enums/notification-type.enum';
import {
  eventReminderText,
  trainingReminderText,
} from './notification-text.util';
import { NotificationsService } from './notifications.service';

// The scheduler tick cadence - also the width of the reminder "capture
// window" below (module spec section 27/28: one periodic job, never one
// cron per Training/Event). A Training/Event is captured exactly once as
// the window sweeps past its reminder point, assuming ticks don't gap by
// more than this; the deduplicationKey unique index is the real
// correctness guarantee regardless (module spec section 38 - "nie polegaj
// tylko na SELECT-before-INSERT").
const TICK_MINUTES = 5;

type ReminderLead = 24 | 2;

@Injectable()
export class NotificationReminderScheduler {
  private readonly logger = new Logger(NotificationReminderScheduler.name);

  constructor(
    private readonly em: EntityManager,
    private readonly notificationsService: NotificationsService,
  ) {}

  /**
   * `@CreateRequestContext()` is required here, not optional decoration:
   * `@nestjs/schedule`'s CronJob fires from a timer, entirely outside the
   * Express request pipeline, so `@mikro-orm/nestjs`'s own
   * `MikroOrmMiddleware` (which wraps every real HTTP request in a
   * `RequestContext` - see MikroOrmCoreModule.configure()) never runs for
   * it. Without this decorator, `this.em` here is the raw, unforked global
   * EntityManager, and - because this project sets `allowGlobalContext:
   * false` (see mikro-orm-options.factory.ts) - every single tick would
   * throw "Using global EntityManager instance methods for context
   * specific actions is disallowed" (confirmed: this is exactly what was
   * happening before this fix, silently swallowed by the try/catch below,
   * every 5 minutes, in every environment - reminders have never actually
   * been sent). The decorator forks `this.em` fresh and runs the method
   * body inside a new `RequestContext` (AsyncLocalStorage), the same
   * mechanism a real HTTP request gets for free - see
   * notification-reminder.scheduler.spec.ts's "runs inside a MikroORM
   * RequestContext" regression test.
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  @CreateRequestContext()
  async run(): Promise<void> {
    try {
      await this.processTrainingReminders(24);
      await this.processTrainingReminders(2);
      await this.processEventReminders(24);
      await this.processEventReminders(2);
    } catch (error) {
      // A reminder tick must never crash the process - see this class's
      // own "best-effort, next tick retries naturally" framing.
      this.logger.error('Reminder scheduler tick failed', error as Error);
    }
  }

  private reminderWindow(leadHours: ReminderLead): { start: Date; end: Date } {
    const now = new Date();
    const start = new Date(now.getTime() + leadHours * 60 * 60 * 1000);
    const end = new Date(start.getTime() + TICK_MINUTES * 60 * 1000);
    return { start, end };
  }

  // ─── Training ────────────────────────────────────────────────────────

  private async processTrainingReminders(
    leadHours: ReminderLead,
  ): Promise<void> {
    const em = this.em;
    const { start, end } = this.reminderWindow(leadHours);
    const type =
      leadHours === 24
        ? NotificationType.TRAINING_REMINDER_24H
        : NotificationType.TRAINING_REMINDER_2H;
    const preferenceField =
      leadHours === 24 ? 'trainingReminder24h' : 'trainingReminder2h';

    const trainings = await em.find(
      Training,
      {
        status: TrainingStatus.SCHEDULED,
        startsAt: { $gte: start, $lt: end },
      },
      { populate: ['section'] },
    );
    if (trainings.length === 0) {
      return;
    }

    for (const training of trainings) {
      const recipientIds = await this.resolveTrainingReminderRecipientIds(
        em,
        training,
      );
      if (recipientIds.size === 0) {
        continue;
      }
      const allowedIds = await this.filterByReminderPreference(
        em,
        [...recipientIds],
        preferenceField,
      );
      if (allowedIds.length === 0) {
        continue;
      }

      const { title, body } = trainingReminderText(
        training.startsAt,
        leadHours,
      );
      const params: CreateNotificationParams[] = allowedIds.map((userId) => ({
        recipient: em.getReference(User, userId),
        category: NotificationCategory.TRAINING,
        type,
        title,
        body,
        targetType: NotificationTargetType.TRAINING,
        targetId: training.id,
        contextSection: training.section,
        deduplicationKey: `${type}:${training.id}:${userId}`,
      }));
      await this.notificationsService.createMany(em, params);
    }
  }

  /**
   * Mirrors TrainingNotificationsService.resolveRecipientIds, plus the
   * reminder-specific RSVP=NO exclusion (module spec section 29): active
   * Section members receive a reminder unless they explicitly declined
   * (RSVP NO); external RSVP holders (no Section membership) only receive
   * one if they explicitly said YES/MAYBE.
   */
  private async resolveTrainingReminderRecipientIds(
    em: EntityManager,
    training: Training,
  ): Promise<Set<string>> {
    const memberships = await em.find(
      SectionMembership,
      {
        section: training.section.id,
        status: {
          $in: [
            SectionMembershipStatus.ACTIVE,
            SectionMembershipStatus.READ_ONLY,
          ],
        },
      },
      { fields: ['user'] },
    );
    const rsvps = await em.find(
      TrainingRsvp,
      { training: training.id },
      { fields: ['user', 'status'] },
    );
    const rsvpByUser = new Map(rsvps.map((r) => [r.user.id, r.status]));

    const recipients = new Set<string>();
    for (const membership of memberships) {
      if (rsvpByUser.get(membership.user.id) === TrainingRsvpStatus.NO) {
        continue;
      }
      recipients.add(membership.user.id);
    }
    for (const rsvp of rsvps) {
      if (
        rsvp.status === TrainingRsvpStatus.YES ||
        rsvp.status === TrainingRsvpStatus.MAYBE
      ) {
        recipients.add(rsvp.user.id);
      }
    }
    return recipients;
  }

  // ─── Event ───────────────────────────────────────────────────────────

  private async processEventReminders(leadHours: ReminderLead): Promise<void> {
    const em = this.em;
    const { start, end } = this.reminderWindow(leadHours);
    const type =
      leadHours === 24
        ? NotificationType.EVENT_REMINDER_24H
        : NotificationType.EVENT_REMINDER_2H;
    const preferenceField =
      leadHours === 24 ? 'eventReminder24h' : 'eventReminder2h';

    const events = await em.find(
      Event,
      {
        status: EventStatus.PUBLISHED,
        startsAt: { $gte: start, $lt: end },
      },
      { populate: ['communityGroup', 'communitySection'] },
    );
    if (events.length === 0) {
      return;
    }

    for (const event of events) {
      const attendees = await em.find(
        EventAttendee,
        {
          event: event.id,
          subjectUser: { $ne: null },
          rsvpStatus: {
            $in: [EventRsvpStatus.GOING, EventRsvpStatus.MAYBE],
          },
        },
        { populate: ['subjectUser'] },
      );
      const recipientIds = new Set(attendees.map((a) => a.subjectUser!.id));
      if (recipientIds.size === 0) {
        continue;
      }
      const allowedIds = await this.filterByReminderPreference(
        em,
        [...recipientIds],
        preferenceField,
      );
      if (allowedIds.length === 0) {
        continue;
      }

      const { title, body } = eventReminderText(
        event.name,
        event.startsAt,
        leadHours,
      );
      const community = eventCommunity(event);
      const params: CreateNotificationParams[] = allowedIds.map((userId) => ({
        recipient: em.getReference(User, userId),
        category: NotificationCategory.EVENT,
        type,
        title,
        body,
        targetType: NotificationTargetType.EVENT,
        targetId: event.id,
        contextGroup: community instanceof Group ? community : null,
        contextSection: community instanceof Section ? community : null,
        deduplicationKey: `${type}:${event.id}:${userId}`,
      }));
      await this.notificationsService.createMany(em, params);
    }
  }

  // ─── Shared ──────────────────────────────────────────────────────────

  /**
   * A reminder-disabled recipient never gets the Notification created at
   * all (module spec section 30) - unlike every other Notification type,
   * where a preference only ever suppresses push, never the inbox row.
   */
  private async filterByReminderPreference(
    em: EntityManager,
    userIds: string[],
    field:
      | 'trainingReminder24h'
      | 'trainingReminder2h'
      | 'eventReminder24h'
      | 'eventReminder2h',
  ): Promise<string[]> {
    if (userIds.length === 0) {
      return [];
    }
    const rows = await em.find(UserNotificationPreferences, {
      user: { $in: userIds },
    });
    const disabled = new Set(
      rows.filter((row) => row[field] === false).map((row) => row.user.id),
    );
    return userIds.filter((id) => !disabled.has(id));
  }
}
