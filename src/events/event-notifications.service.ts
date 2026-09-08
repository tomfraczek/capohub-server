import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { GroupFollowService } from '../groups/group-follow.service';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { NotificationCategory } from '../notifications/enums/notification-category.enum';
import { NotificationTargetType } from '../notifications/enums/notification-target-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  eventCancelledText,
  eventLocationChangedText,
  eventPublishedText,
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
import { EventVisibility } from './enums/event-visibility.enum';

const ACTIVE_MEMBERSHIP_STATUSES = [
  SectionMembershipStatus.ACTIVE,
  SectionMembershipStatus.READ_ONLY,
];

/**
 * Raises a central Notification (see NotificationsService) for every
 * registered participant of one Event - EventAttendee rows with a
 * resolvable subjectUser (SELF/CHILD_ACCOUNT; a CHILD_DEPENDENT has no
 * User to notify - module spec §24: never "everyone who can merely view
 * the Event", only actual registrants). notifyPublished() below is the one
 * exception - see its own comment.
 */
@Injectable()
export class EventNotificationsService {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly groupFollowService: GroupFollowService,
  ) {}

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

  /**
   * Fires exactly once, on DRAFT -> PUBLISHED (see EventsService.publish) -
   * the Community-audience counterpart to notify() above, which only ever
   * reaches already-registered EventAttendees (module: "Event utworzony
   * przez sekcję/grupę"). No-op for a User-organized Event (organizerType
   * USER - eventCommunity() returns null, see event-community.util.ts's own
   * comment) - there is no Community to derive an audience from.
   *
   * Audience, deduplicated to one Notification per recipient regardless of
   * how many ways they qualify (module: "Powiadomienia zawsze muszą być
   * deduplikowane" / "dostaje tylko JEDNO powiadomienie"):
   *  - Section-organized Event: the Section's own active
   *    (ACTIVE/READ_ONLY) members.
   *  - Group-organized Event: every unique active member across the
   *    Group's *direct* Sections (`section.parentGroup === group.id`,
   *    never the whole hierarchy subtree - same "no inheritance" rule as
   *    GroupsService.resolveViewerRelation/CommunityOverviewService), PLUS
   *    the Group's followers (see group-follow.entity.ts) - but only when
   *    `event.visibility === PUBLIC`. A COMMUNITY_MEMBERS or INVITE_ONLY
   *    Group Event never reaches followers at all (module: "wewnętrzny
   *    komunikat grupowy -> tylko członkowie sekcji" / "Obserwator grupy
   *    nie powinien automatycznie dostawać treści przeznaczonych wyłącznie
   *    dla członków sekcji") - EventVisibility, already on Event, is reused
   *    here rather than inventing a second audience/visibility concept.
   */
  async notifyPublished(em: EntityManager, event: Event): Promise<void> {
    const community = eventCommunity(event);
    if (!community) {
      return;
    }

    const recipientIds =
      community instanceof Section
        ? await this.resolveSectionMemberIds(em, community.id)
        : await this.resolveGroupAudienceIds(em, community, event.visibility);
    if (recipientIds.size === 0) {
      return;
    }

    const { title, body } = eventPublishedText(event.name);
    const params: CreateNotificationParams[] = [...recipientIds].map(
      (userId) => ({
        recipient: em.getReference(User, userId),
        category: NotificationCategory.EVENT,
        type: NotificationType.EVENT_PUBLISHED,
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

  private async resolveSectionMemberIds(
    em: EntityManager,
    sectionId: string,
  ): Promise<Set<string>> {
    const memberships = await em.find(
      SectionMembership,
      { section: sectionId, status: { $in: ACTIVE_MEMBERSHIP_STATUSES } },
      { fields: ['user'] },
    );
    return new Set(memberships.map((membership) => membership.user.id));
  }

  private async resolveGroupAudienceIds(
    em: EntityManager,
    group: Group,
    visibility: EventVisibility,
  ): Promise<Set<string>> {
    const directSections = await em.find(
      Section,
      { parentGroup: group.id },
      { fields: ['id'] },
    );
    const recipientIds = new Set<string>();
    if (directSections.length > 0) {
      const memberships = await em.find(
        SectionMembership,
        {
          section: { $in: directSections.map((section) => section.id) },
          status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
        },
        { fields: ['user'] },
      );
      for (const membership of memberships) {
        recipientIds.add(membership.user.id);
      }
    }

    if (visibility === EventVisibility.PUBLIC) {
      const followerIds = await this.groupFollowService.listFollowerUserIds(
        group.id,
      );
      for (const followerId of followerIds) {
        recipientIds.add(followerId);
      }
    }

    return recipientIds;
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
