import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { NotificationCategory } from '../notifications/enums/notification-category.enum';
import { NotificationTargetType } from '../notifications/enums/notification-target-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  eventCancelledText,
  eventLocationChangedText,
  eventTimeChangedText,
} from '../notifications/notification-text.util';
import {
  CreateNotificationParams,
  NotificationsService,
} from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { EventAttendee } from './entities/event-attendee.entity';
import { Event } from './entities/event.entity';
import { eventCommunity } from './event-community.util';

/**
 * Raises a central Notification (see NotificationsService) for every
 * registered participant of one Event - EventAttendee rows with a
 * resolvable subjectUser (SELF/CHILD_ACCOUNT; a CHILD_DEPENDENT has no
 * User to notify - module spec §24: never "everyone who can merely view
 * the Event", only actual registrants).
 */
@Injectable()
export class EventNotificationsService {
  constructor(private readonly notificationsService: NotificationsService) {}

  async notify(
    em: EntityManager,
    event: Event,
    type: NotificationType,
  ): Promise<void> {
    const attendees = await em.find(
      EventAttendee,
      { event: event.id, subjectUser: { $ne: null } },
      { fields: ['subjectUser'] },
    );
    const recipientIds = new Set(attendees.map((a) => a.subjectUser!.id));
    if (recipientIds.size === 0) {
      return;
    }

    const { title, body } = this.buildText(type, event);
    const community = eventCommunity(event);
    const params: CreateNotificationParams[] = [...recipientIds].map(
      (userId) => ({
        recipient: em.getReference(User, userId),
        category: NotificationCategory.EVENT,
        type,
        title,
        body,
        targetType: NotificationTargetType.EVENT,
        targetId: event.id,
        contextGroup: community instanceof Group ? community : null,
        contextSection: community instanceof Section ? community : null,
      }),
    );
    await this.notificationsService.createMany(em, params);
  }

  private buildText(
    type: NotificationType,
    event: Event,
  ): { title: string; body: string } {
    switch (type) {
      case NotificationType.EVENT_CANCELLED:
        return eventCancelledText(event.name);
      case NotificationType.EVENT_TIME_CHANGED:
        return eventTimeChangedText(event.name, event.startsAt);
      case NotificationType.EVENT_LOCATION_CHANGED:
        return eventLocationChangedText(event.name);
      default:
        throw new Error(`Unsupported event notification type: ${type}`);
    }
  }
}
