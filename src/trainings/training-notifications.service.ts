import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { User } from '../users/entities/user.entity';
import { TrainingNotification } from './entities/training-notification.entity';
import { Training } from './entities/training.entity';
import { TrainingRsvp } from './entities/training-rsvp.entity';
import { TrainingNotificationType } from './enums/training-notification-type.enum';
import { TrainingRsvpStatus } from './enums/training-rsvp-status.enum';

/**
 * Writes minimal in-app TrainingNotification rows for the users "related to"
 * one specific Training - its Section's active members plus anyone who has
 * RSVP'd YES/MAYBE (covers an external RSVP holder under allowExternalRsvp -
 * see the module spec §12: "Nie spamuj całej hierarchii Group"). Never
 * delivers a push/email - see training-notification.entity.ts.
 */
@Injectable()
export class TrainingNotificationsService {
  async notify(
    em: EntityManager,
    training: Training,
    type: TrainingNotificationType,
  ): Promise<void> {
    const recipientIds = await this.resolveRecipientIds(em, training);
    if (recipientIds.size === 0) {
      return;
    }
    for (const userId of recipientIds) {
      const notification = new TrainingNotification();
      notification.recipient = em.getReference(User, userId);
      notification.training = training;
      notification.type = type;
      em.persist(notification);
    }
    await em.flush();
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
