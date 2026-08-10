import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { NotificationCategory } from '../notifications/enums/notification-category.enum';
import { NotificationTargetType } from '../notifications/enums/notification-target-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  trainingCancelledText,
  trainingLocationChangedText,
  trainingTimeChangedText,
  trainingTrainerChangedText,
} from '../notifications/notification-text.util';
import {
  CreateNotificationParams,
  NotificationsService,
} from '../notifications/notifications.service';
import { User } from '../users/entities/user.entity';
import { Training } from './entities/training.entity';
import { TrainingRsvp } from './entities/training-rsvp.entity';
import { TrainingRsvpStatus } from './enums/training-rsvp-status.enum';

/**
 * Raises a central Notification (see NotificationsService) for every user
 * "related to" one specific Training - its Section's active members plus
 * anyone who has RSVP'd YES/MAYBE (covers an external RSVP holder under
 * allowExternalRsvp - module spec §12/§25: "Nie spamuj całej hierarchii
 * Group", recipient semantics unchanged from before this module).
 *
 * This is the sole surviving descendant of the removed TrainingNotification
 * table - the recipient-resolution logic is unchanged, only the sink it
 * writes to (see this module's final report).
 */
@Injectable()
export class TrainingNotificationsService {
  constructor(private readonly notificationsService: NotificationsService) {}

  async notify(
    em: EntityManager,
    training: Training,
    type: NotificationType,
  ): Promise<void> {
    const recipientIds = await this.resolveRecipientIds(em, training);
    if (recipientIds.size === 0) {
      return;
    }

    const { title, body } = this.buildText(type, training);
    const params: CreateNotificationParams[] = [...recipientIds].map(
      (userId) => ({
        recipient: em.getReference(User, userId),
        category: NotificationCategory.TRAINING,
        type,
        title,
        body,
        targetType: NotificationTargetType.TRAINING,
        targetId: training.id,
        contextSection: training.section,
      }),
    );
    await this.notificationsService.createMany(em, params);
  }

  private buildText(
    type: NotificationType,
    training: Training,
  ): { title: string; body: string } {
    switch (type) {
      case NotificationType.TRAINING_CANCELLED:
        return trainingCancelledText(null, training.startsAt);
      case NotificationType.TRAINING_TIME_CHANGED:
        return trainingTimeChangedText(training.startsAt);
      case NotificationType.TRAINING_LOCATION_CHANGED:
        return trainingLocationChangedText(training.locationName);
      case NotificationType.TRAINING_TRAINER_CHANGED:
        return trainingTrainerChangedText();
      default:
        throw new Error(`Unsupported training notification type: ${type}`);
    }
  }

  private async resolveRecipientIds(
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
      {
        training: training.id,
        status: { $in: [TrainingRsvpStatus.YES, TrainingRsvpStatus.MAYBE] },
      },
      { fields: ['user'] },
    );
    const ids = new Set<string>();
    for (const membership of memberships) {
      ids.add(membership.user.id);
    }
    for (const rsvp of rsvps) {
      ids.add(rsvp.user.id);
    }
    return ids;
  }
}
