/**
 * E2E tests for domain integrations feeding the central Notifications inbox
 * (module spec §§20, 22-23, 46): Training, Announcement, and Membership -
 * confirming the right Notification appears for the right recipient, and
 * that a non-notification-worthy edit (description-only) creates nothing.
 * Event and Formal Rank Correction integrations follow the identical
 * `NotificationsService.createMany` path (see event-notifications.service.ts
 * / formal-rank-correction.service.ts) and are covered at the unit level;
 * duplicating a full Event/Graduation fixture here would exceed this
 * module's "maksymalnie 3 targeted e2e" budget without adding real risk
 * coverage.
 */

import {
  INestApplication,
  UnauthorizedException,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from '@mikro-orm/core';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { ClerkAuthService } from '../src/auth/clerk/clerk-auth.service';
import { CLERK_CLIENT } from '../src/auth/clerk/clerk-client.provider';
import { AuthContext } from '../src/auth/types/auth-context.type';
import { AppConfigService } from '../src/config/app.config';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';
import { closeE2eApp } from './close-e2e-app.helper';
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { User } from '../src/users/entities/user.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { Section } from '../src/groups/entities/section.entity';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { MembershipRequest } from '../src/groups/entities/membership-request.entity';
import { MembershipRequestResponseDto } from '../src/groups/dto/membership-request-response.dto';
import { MembershipRequestTarget } from '../src/groups/enums/membership-request-target.enum';
import { HierarchyInvitation } from '../src/groups/entities/hierarchy-invitation.entity';
import { HierarchyInvitationResponseDto } from '../src/groups/dto/hierarchy-invitation-response.dto';
import { Announcement } from '../src/announcements/entities/announcement.entity';
import { AnnouncementResponseDto } from '../src/announcements/dto/announcement-response.dto';
import { Training } from '../src/trainings/entities/training.entity';
import { TrainingResponseDto } from '../src/trainings/dto/training-response.dto';
import { TrainingVisibility } from '../src/trainings/enums/training-visibility.enum';
import { Notification } from '../src/notifications/entities/notification.entity';
import { NotificationListResponseDto } from '../src/notifications/dto/notification-list-response.dto';
import { NotificationTargetType } from '../src/notifications/enums/notification-target-type.enum';
import { NotificationType } from '../src/notifications/enums/notification-type.enum';
import { ExpoPushTransport } from '../src/notifications/expo-push.transport';

// No fixed "OWNER_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs many
// independent Groups, so createGroup() mints a fresh, throwaway owner per
// call instead (see its own comment).
const MEMBER_TOKEN = 'valid-notif-integ-member-token';

const MEMBER_CLERK_ID = 'user_test_notif_integ_member';

const TOKEN_TO_AUTH: Record<string, AuthContext> = {
  [MEMBER_TOKEN]: {
    userId: MEMBER_CLERK_ID,
    sessionId: 'sess_notif_integ_member',
    tokenType: 'session_token',
    claims: { sub: MEMBER_CLERK_ID, sid: 'sess_notif_integ_member' },
  },
};

const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = Object.fromEntries(
  Object.keys(TOKEN_TO_AUTH).map((token) => {
    const clerkId = TOKEN_TO_AUTH[token].userId;
    return [
      clerkId,
      {
        imageUrl: `https://img.clerk.com/${clerkId}.png`,
        primaryEmailAddress: { emailAddress: `${clerkId}@example.com` },
      },
    ];
  }),
);

const fixtureClerkAuthService = {
  verifySessionToken: (token: string) => {
    const auth = TOKEN_TO_AUTH[token];
    if (auth) return Promise.resolve(auth);
    return Promise.reject(new UnauthorizedException('Authentication required'));
  },
};

const fixtureClerkClient = {
  users: {
    getUser: (clerkUserId: string) => {
      const profile = FIXTURE_CLERK_PROFILES[clerkUserId];
      if (!profile) {
        return Promise.reject(
          new Error(`Unknown test Clerk user ${clerkUserId}`),
        );
      }
      return Promise.resolve({ id: clerkUserId, ...profile });
    },
    deleteUser: () => Promise.resolve(),
  },
};

// Never a real Expo HTTP call from an e2e test (module spec §42).
const fixtureExpoPushTransport = { send: () => Promise.resolve([]) };

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Notification domain integrations (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const localUserIdByToken = new Map<string, string>();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
      .overrideProvider(ExpoPushTransport)
      .useValue(fixtureExpoPushTransport)
      .compile();

    app = moduleFixture.createNestApplication();
    const appConfig = app.get(AppConfigService);
    app.setGlobalPrefix(appConfig.apiPrefix);
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: appConfig.apiVersion,
      prefix: false,
    });
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    for (const token of Object.keys(TOKEN_TO_AUTH)) {
      await request(app.getHttpServer())
        .get('/api/v1/users/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: TOKEN_TO_AUTH[token].userId,
      });
      localUserIdByToken.set(token, user.id);
    }
  });

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      await cleanup.nativeDelete(Notification, {
        recipient: { $in: [...localUserIdByToken.values()] },
      });
      await cleanup.nativeDelete(MembershipRequest, {
        $or: [
          { targetGroup: { $in: createdGroupIds } },
          { targetSection: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(HierarchyInvitation, {
        $or: [
          { parentGroup: { $in: createdGroupIds } },
          { targetGroup: { $in: createdGroupIds } },
          { targetSection: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(Announcement, {
        $or: [
          { communityGroup: { $in: createdGroupIds } },
          { communitySection: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(Training, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
      });
      await cleanup.nativeDelete(Section, {
        parentGroup: { $in: createdGroupIds },
      });
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // FIXTURE_CLERK_PROFILES, not the old frozen TEST_CLERK_USER_IDS
      // snapshot - createGroup (via createFreshGroupOwner) registers a
      // fresh fixture user per call, mutating FIXTURE_CLERK_PROFILES in
      // place, so it must be read fresh here to catch every one of them.
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: Object.keys(FIXTURE_CLERK_PROFILES) },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Notif Integ Test Org',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
      ...overrides,
    };
  }

  function sectionPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Notif Integ Test Section',
      description: null,
      logoUrl: null,
      coverImageUrl: null,
      contactEmail: null,
      contactPhone: null,
      websiteUrl: null,
      facebookUrl: null,
      instagramUrl: null,
      youtubeUrl: null,
      isPublic: true,
      isHidden: false,
      memberInvitesAllowed: false,
      timezone: 'Europe/Warsaw',
      currencyCode: 'PLN',
      country: 'PL',
      city: 'Warsaw',
      region: 'Mazovia',
      geonameId: 756135,
      ...overrides,
    };
  }

  async function createGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'notif-integ',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
  }

  async function createSection(
    group: { id: string; token: string },
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const section = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${group.id}/sections`)
        .set('Authorization', `Bearer ${group.token}`)
        .send(sectionPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(section.id);
    return section;
  }

  async function addSectionMember(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken) })
      .expect(201);
  }

  async function notificationsFor(
    token: string,
  ): Promise<NotificationListResponseDto> {
    return bodyOf<NotificationListResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/notifications?limit=100')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  describe('Trainings', () => {
    function trainingPayload(
      overrides: Record<string, unknown> = {},
    ): Record<string, unknown> {
      return {
        startsAt: '2031-06-02T18:00:00.000Z',
        endsAt: '2031-06-02T20:00:00.000Z',
        locationName: 'Dojo',
        locationAddress: null,
        latitude: null,
        longitude: null,
        // Just needs to be some valid, always-registered user id - no test
        // in this file asserts on trainer identity, and the section's own
        // owner is now a fresh, per-test throwaway user (see createGroup's
        // own comment), not a fixed token this default could reach.
        trainerUserId: localUserIdByToken.get(MEMBER_TOKEN),
        description: 'Regular training',
        visibility: TrainingVisibility.MEMBERS_ONLY,
        ...overrides,
      };
    }

    it('cancelling a Training notifies the Section member with TRAINING_CANCELLED, not the actor-only default', async () => {
      const group = await createGroup();
      const section = await createSection(group);
      await addSectionMember(group.token, section.id, MEMBER_TOKEN);

      const training = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/trainings`)
          .set('Authorization', `Bearer ${group.token}`)
          .send(trainingPayload())
          .expect(201),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/trainings/${training.id}/cancel`)
        .set('Authorization', `Bearer ${group.token}`)
        .send({ scope: 'THIS', reason: null })
        .expect(201);

      const memberNotifications = await notificationsFor(MEMBER_TOKEN);
      const cancelled = memberNotifications.items.find(
        (n) =>
          n.type === NotificationType.TRAINING_CANCELLED &&
          n.targetId === training.id,
      );
      expect(cancelled).toBeDefined();
      expect(cancelled?.contextSectionId).toBe(section.id);
    });

    it('changing only the description never creates a Notification', async () => {
      const group = await createGroup();
      const section = await createSection(group);
      await addSectionMember(group.token, section.id, MEMBER_TOKEN);

      const training = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/trainings`)
          .set('Authorization', `Bearer ${group.token}`)
          .send(trainingPayload())
          .expect(201),
      );

      const before = await notificationsFor(MEMBER_TOKEN);

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/trainings/${training.id}`)
        .set('Authorization', `Bearer ${group.token}`)
        .send({ scope: 'THIS', description: 'A brand new description only' })
        .expect(200);

      const after = await notificationsFor(MEMBER_TOKEN);
      expect(after.total).toBe(before.total);
    });

    it('changing the time creates a TRAINING_TIME_CHANGED Notification', async () => {
      const group = await createGroup();
      const section = await createSection(group);
      await addSectionMember(group.token, section.id, MEMBER_TOKEN);

      const training = await bodyOf<TrainingResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/trainings`)
          .set('Authorization', `Bearer ${group.token}`)
          .send(trainingPayload())
          .expect(201),
      );

      await request(app.getHttpServer())
        .patch(`/api/v1/sections/${section.id}/trainings/${training.id}`)
        .set('Authorization', `Bearer ${group.token}`)
        .send({
          scope: 'THIS',
          startsAt: '2031-06-02T19:00:00.000Z',
          endsAt: '2031-06-02T21:00:00.000Z',
        })
        .expect(200);

      const after = await notificationsFor(MEMBER_TOKEN);
      expect(
        after.items.some(
          (n) =>
            n.type === NotificationType.TRAINING_TIME_CHANGED &&
            n.targetId === training.id,
        ),
      ).toBe(true);
    });
  });

  describe('Announcements', () => {
    it('a normal Announcement notifies with ANNOUNCEMENT_PUBLISHED', async () => {
      const group = await createGroup();
      const section = await createSection(group);
      await addSectionMember(group.token, section.id, MEMBER_TOKEN);

      const announcement = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/announcements`)
          .set('Authorization', `Bearer ${group.token}`)
          .send({
            title: 'Regular update',
            body: 'Nothing urgent.',
            isPinned: false,
            isImportant: false,
            expiresAt: '2031-01-01T00:00:00.000Z',
          })
          .expect(201),
      );

      const memberNotifications = await notificationsFor(MEMBER_TOKEN);
      const found = memberNotifications.items.find(
        (n) => n.targetId === announcement.id,
      );
      expect(found?.type).toBe(NotificationType.ANNOUNCEMENT_PUBLISHED);
    });

    it('an important Announcement notifies with IMPORTANT_ANNOUNCEMENT_PUBLISHED', async () => {
      const group = await createGroup();
      const section = await createSection(group);
      await addSectionMember(group.token, section.id, MEMBER_TOKEN);

      const announcement = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/sections/${section.id}/announcements`)
          .set('Authorization', `Bearer ${group.token}`)
          .send({
            title: 'Urgent update',
            body: 'Please read.',
            isPinned: false,
            isImportant: true,
            expiresAt: '2031-01-01T00:00:00.000Z',
          })
          .expect(201),
      );

      const memberNotifications = await notificationsFor(MEMBER_TOKEN);
      const found = memberNotifications.items.find(
        (n) => n.targetId === announcement.id,
      );
      expect(found?.type).toBe(
        NotificationType.IMPORTANT_ANNOUNCEMENT_PUBLISHED,
      );
    });
  });

  describe('Membership', () => {
    it('a private Section join request notifies the OWNER with SECTION_JOIN_REQUEST_RECEIVED and a resolvable deep link', async () => {
      const group = await createGroup();
      const section = await createSection(group, { isPublic: false });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .send({ targetType: MembershipRequestTarget.SECTION })
        .expect(200);

      const ownerNotifications = await notificationsFor(group.token);
      const found = ownerNotifications.items.find(
        (n) => n.type === NotificationType.SECTION_JOIN_REQUEST_RECEIVED,
      );
      expect(found).toBeDefined();
      expect(found?.targetType).toBe(NotificationTargetType.MEMBERSHIP_REQUEST);
      expect(found?.contextSectionId).toBe(section.id);

      // Deep-link contract: contextSectionId + targetId alone must resolve
      // straight to the pending request, no global listing/guessing.
      const pending = await bodyOf<MembershipRequestResponseDto[]>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${found!.contextSectionId}/join-requests`)
          .set('Authorization', `Bearer ${group.token}`)
          .expect(200),
      );
      expect(pending.some((r) => r.id === found!.targetId)).toBe(true);
    });
  });

  describe('Hierarchy invitations', () => {
    it('inviting a Group as a child notifies the target Group OWNER with HIERARCHY_INVITATION and a resolvable deep link', async () => {
      const parent = await createGroup({ name: 'Notif Integ Parent Org' });
      // A genuinely different owner than `parent` - the point of this test
      // is the cross-owner hierarchy-invitation flow, so `target` must be
      // owned by someone else. createGroup() always mints a fresh,
      // independent owner (see its own comment), which already guarantees
      // that without needing a second fixed token here.
      const target = await createGroup({ name: 'Notif Integ Target Org' });

      const invitation = await bodyOf<HierarchyInvitationResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${parent.id}/child-invitations`)
          .set('Authorization', `Bearer ${parent.token}`)
          .send({ targetType: 'GROUP', targetId: target.id })
          .expect(201),
      );

      const targetOwnerNotifications = await notificationsFor(target.token);
      const found = targetOwnerNotifications.items.find(
        (n) => n.type === NotificationType.HIERARCHY_INVITATION_RECEIVED,
      );
      expect(found).toBeDefined();
      expect(found?.targetType).toBe(
        NotificationTargetType.HIERARCHY_INVITATION,
      );
      expect(found?.targetId).toBe(invitation.id);
      // Context is the *target*, not the parent - that is where the
      // recipient (the target's OWNER) actually reviews/acts on it.
      expect(found?.contextGroupId).toBe(target.id);
      expect(found?.contextSectionId).toBeNull();

      // Deep-link contract: contextGroupId + targetId alone must resolve
      // straight to this exact invitation via the target-side "received"
      // listing, no global search.
      const received = await bodyOf<HierarchyInvitationResponseDto[]>(
        request(app.getHttpServer())
          .get(
            `/api/v1/groups/${found!.contextGroupId}/hierarchy-invitations/received`,
          )
          .set('Authorization', `Bearer ${target.token}`)
          .expect(200),
      );
      expect(received.some((r) => r.id === found!.targetId)).toBe(true);
    });
  });
});
