/**
 * Unit tests for EventNotificationsService.notifyPublished - the
 * Community-audience broadcast fired once on DRAFT -> PUBLISHED (see
 * EventsService.publish), covering the Community domain's own notification
 * rules:
 *  - a Section Event notifies exactly that Section's active members
 *  - a Group Event notifies every unique active member across the Group's
 *    direct Sections
 *  - a member of two Sections of the same Group gets exactly one
 *    Notification (deduplication)
 *  - a PUBLIC Group Event additionally reaches the Group's followers
 *  - a COMMUNITY_MEMBERS/INVITE_ONLY (internal) Group Event never reaches
 *    followers
 *  - a User-organized Event (no Community at all) raises nothing
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { GroupFollowService } from '../groups/group-follow.service';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  CreateNotificationParams,
  NotificationsService,
} from '../notifications/notifications.service';
import { EventNotificationsService } from './event-notifications.service';
import { Event } from './entities/event.entity';
import { EventOrganizerType } from './enums/event-organizer-type.enum';
import { EventVisibility } from './enums/event-visibility.enum';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordão de Ouro';
  group.status = GroupStatus.ACTIVE;
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Cordão de Ouro Poznan';
  section.status = GroupStatus.ACTIVE;
  return Object.assign(section, overrides);
}

function buildMembership(sectionId: string, userId: string): SectionMembership {
  const membership = new SectionMembership();
  membership.section = { id: sectionId } as never;
  membership.user = { id: userId } as never;
  membership.status = SectionMembershipStatus.ACTIVE;
  return membership;
}

function buildEvent(overrides: Partial<Event> = {}): Event {
  const event = new Event();
  event.id = 'event-1';
  event.name = 'Roda de Capoeira';
  event.organizerType = EventOrganizerType.SECTION;
  event.visibility = EventVisibility.COMMUNITY_MEMBERS;
  event.communityGroup = null;
  event.communitySection = null;
  return Object.assign(event, overrides);
}

function buildService(routing: {
  sections?: Section[];
  memberships?: SectionMembership[];
  followerIds?: string[];
}) {
  const em = {
    find: jest.fn((entity: unknown) => {
      if (entity === Section) return Promise.resolve(routing.sections ?? []);
      if (entity === SectionMembership) {
        return Promise.resolve(routing.memberships ?? []);
      }
      throw new Error(`Unexpected find entity in test mock: ${String(entity)}`);
    }),
    getReference: jest.fn((_entity: unknown, id: string) => ({ id }) as never),
  } as unknown as EntityManager;

  // Explicitly typed generics (not a bare jest.fn()) so recipientIdsOf below
  // can read `.mock.calls[0][1]` back with a real type instead of `any`.
  const createMany = jest
    .fn<Promise<unknown[]>, [EntityManager, CreateNotificationParams[]]>()
    .mockResolvedValue([]);
  const notificationsService = {
    createMany,
  } as unknown as NotificationsService;

  // Not read back through `groupFollowService.listFollowerUserIds` in
  // assertions below (only this standalone reference) - casting the mock
  // object to the real GroupFollowService type and then asserting on a
  // property access off it trips @typescript-eslint/unbound-method, same
  // fix as groups.service.spec.ts's imageAssetService mock (see its own
  // comment).
  const listFollowerUserIds = jest
    .fn()
    .mockResolvedValue(routing.followerIds ?? []);
  const groupFollowService = {
    listFollowerUserIds,
  } as unknown as GroupFollowService;

  const service = new EventNotificationsService(
    notificationsService,
    groupFollowService,
  );

  return { service, em, createMany, listFollowerUserIds };
}

function recipientIdsOf(
  createMany: jest.Mock<
    Promise<unknown[]>,
    [EntityManager, CreateNotificationParams[]]
  >,
): string[] {
  const call = createMany.mock.calls[0];
  return (call?.[1] ?? []).map((p) => p.recipient.id);
}

describe('EventNotificationsService.notifyPublished', () => {
  it('notifies exactly a Section Event own active members', async () => {
    const section = buildSection({ id: 'section-1' });
    const event = buildEvent({
      organizerType: EventOrganizerType.SECTION,
      communitySection: section,
    });
    const { service, em, createMany } = buildService({
      memberships: [
        buildMembership('section-1', 'user-1'),
        buildMembership('section-1', 'user-2'),
      ],
    });

    await service.notifyPublished(em, event);

    expect(createMany).toHaveBeenCalledTimes(1);
    expect(recipientIdsOf(createMany).sort()).toEqual(['user-1', 'user-2']);
    const params = createMany.mock.calls[0][1];
    expect(params[0].type).toBe(NotificationType.EVENT_PUBLISHED);
    expect(params[0].contextSection).toBe(section);
    expect(params[0].contextGroup).toBeNull();
  });

  it('notifies every unique active member across a Group direct Sections', async () => {
    const group = buildGroup({ id: 'group-1' });
    const event = buildEvent({
      organizerType: EventOrganizerType.GROUP,
      communityGroup: group,
      visibility: EventVisibility.COMMUNITY_MEMBERS,
    });
    const { service, em, createMany } = buildService({
      sections: [
        buildSection({ id: 'section-a' }),
        buildSection({ id: 'section-b' }),
      ],
      memberships: [
        buildMembership('section-a', 'user-1'),
        buildMembership('section-b', 'user-3'),
      ],
    });

    await service.notifyPublished(em, event);

    expect(recipientIdsOf(createMany).sort()).toEqual(['user-1', 'user-3']);
  });

  it('sends exactly one Notification to a User who is a member of two Sections of the same Group', async () => {
    const group = buildGroup({ id: 'group-1' });
    const event = buildEvent({
      organizerType: EventOrganizerType.GROUP,
      communityGroup: group,
    });
    const { service, em, createMany } = buildService({
      sections: [
        buildSection({ id: 'section-a' }),
        buildSection({ id: 'section-b' }),
      ],
      memberships: [
        buildMembership('section-a', 'user-1'),
        buildMembership('section-b', 'user-1'),
      ],
    });

    await service.notifyPublished(em, event);

    expect(recipientIdsOf(createMany)).toEqual(['user-1']);
  });

  it('a PUBLIC Group Event also reaches the Group followers, deduplicated against Section members', async () => {
    const group = buildGroup({ id: 'group-1' });
    const event = buildEvent({
      organizerType: EventOrganizerType.GROUP,
      communityGroup: group,
      visibility: EventVisibility.PUBLIC,
    });
    const { service, em, createMany, listFollowerUserIds } = buildService({
      sections: [buildSection({ id: 'section-a' })],
      memberships: [buildMembership('section-a', 'user-1')],
      // user-1 is both a Section member AND a follower - must still appear
      // only once.
      followerIds: ['user-1', 'user-2'],
    });

    await service.notifyPublished(em, event);

    expect(listFollowerUserIds).toHaveBeenCalledWith('group-1');
    expect(recipientIdsOf(createMany).sort()).toEqual(['user-1', 'user-2']);
  });

  it.each([EventVisibility.COMMUNITY_MEMBERS, EventVisibility.INVITE_ONLY])(
    'a %s (internal) Group Event never reaches the Group followers',
    async (visibility) => {
      const group = buildGroup({ id: 'group-1' });
      const event = buildEvent({
        organizerType: EventOrganizerType.GROUP,
        communityGroup: group,
        visibility,
      });
      const { service, em, createMany, listFollowerUserIds } = buildService({
        sections: [buildSection({ id: 'section-a' })],
        memberships: [buildMembership('section-a', 'user-1')],
        followerIds: ['user-2'],
      });

      await service.notifyPublished(em, event);

      expect(listFollowerUserIds).not.toHaveBeenCalled();
      expect(recipientIdsOf(createMany)).toEqual(['user-1']);
    },
  );

  it('raises nothing for a User-organized Event (no Community at all)', async () => {
    const event = buildEvent({
      organizerType: EventOrganizerType.USER,
      communityGroup: null,
      communitySection: null,
    });
    const { service, em, createMany } = buildService({});

    await service.notifyPublished(em, event);

    expect(createMany).not.toHaveBeenCalled();
  });

  it('sends nothing when a Group Event has no members and no followers', async () => {
    const group = buildGroup({ id: 'group-1' });
    const event = buildEvent({
      organizerType: EventOrganizerType.GROUP,
      communityGroup: group,
    });
    const { service, em, createMany } = buildService({
      sections: [buildSection({ id: 'section-a' })],
      memberships: [],
    });

    await service.notifyPublished(em, event);

    expect(createMany).not.toHaveBeenCalled();
  });
});
