/**
 * E2E tests for Announcements (GET/POST/PATCH/DELETE .../announcements...).
 *
 * Scenarios:
 *  1. Publish to GROUP / SECTION / RECIPIENT_GROUP - exactly one recipient,
 *     correct visibility for each
 *  2. A Section-scoped Announcement is not visible to a root-org member who
 *     was never added to that specific Section
 *  3. A Recipient Group's snapshot is immutable - changing its members
 *     later never changes an already-published Announcement's audience
 *  4. Validation: expiresAt required + must be future; recipientGroupId
 *     must reference an active Recipient Group
 *  5. Any number of Announcements may be pinned; sort order is
 *     pinned-first, newest-first within each group
 *  6. Expired Announcements disappear from the active list and are only
 *     reachable through the OWNER/ADMIN-only archive
 *  7. Editing sets `editedAt` and never re-sends a push
 *  8. Deleting is a soft delete - the row survives in the archive
 *  9. Read tracking is persistent, idempotent, and drives unreadCount
 * 10. Push notifications: only sent when requested, only to current
 *     recipients, deduplicated, never to the author, never resent on edit
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
import { AnnouncementResponseDto } from '../src/announcements/dto/announcement-response.dto';
import { AnnouncementListResult } from '../src/announcements/announcements.service';
import { Announcement } from '../src/announcements/entities/announcement.entity';
import { AnnouncementRecipient } from '../src/announcements/entities/announcement-recipient.entity';
import { AnnouncementRead } from '../src/announcements/entities/announcement-read.entity';
import { PUSH_NOTIFICATION_PORT } from '../src/announcements/integration/push-notification.port';
import { RecipientGroupResponseDto } from '../src/groups/dto/recipient-group-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
import { Group } from '../src/groups/entities/group.entity';
import { RecipientGroupMember } from '../src/groups/entities/recipient-group-member.entity';
import { RecipientGroup } from '../src/groups/entities/recipient-group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { User } from '../src/users/entities/user.entity';

const OWNER_TOKEN = 'valid-ann-owner-token';
const ADMIN_TOKEN = 'valid-ann-admin-token';
const MEMBER_TOKEN = 'valid-ann-member-token';
const SECTION_MEMBER_TOKEN = 'valid-ann-section-member-token';
const RECIPIENT_TOKEN = 'valid-ann-recipient-token';
const OUTSIDER_TOKEN = 'valid-ann-outsider-token';

const TOKENS = [
  OWNER_TOKEN,
  ADMIN_TOKEN,
  MEMBER_TOKEN,
  SECTION_MEMBER_TOKEN,
  RECIPIENT_TOKEN,
  OUTSIDER_TOKEN,
] as const;

const TOKEN_TO_AUTH: Record<string, AuthContext> = {};
const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {};

for (const token of TOKENS) {
  const suffix = token.replace('valid-ann-', '').replace('-token', '');
  const clerkId = `user_test_ann_${suffix.replace(/-/g, '_')}`;
  TOKEN_TO_AUTH[token] = {
    userId: clerkId,
    sessionId: `sess_ann_${suffix}`,
    tokenType: 'session_token',
    claims: { sub: clerkId, sid: `sess_ann_${suffix}` },
  };
  FIXTURE_CLERK_PROFILES[clerkId] = {
    imageUrl: `https://img.clerk.com/ann-${suffix}.png`,
    primaryEmailAddress: { emailAddress: `ann.${suffix}@example.com` },
  };
}

const TEST_CLERK_USER_IDS = Object.keys(FIXTURE_CLERK_PROFILES);

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

async function bodyOf<T>(req: request.Test): Promise<T> {
  const res = await req;
  return res.body as T;
}

describe('Announcements (e2e)', () => {
  let app: INestApplication<App>;
  let sendToUsers: jest.Mock;
  const createdGroupIds: string[] = [];
  const localUserIdByToken = new Map<string, string>();

  beforeAll(async () => {
    sendToUsers = jest
      .fn()
      .mockResolvedValue({ attempted: 0, sent: 0, failed: 0 });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ClerkAuthService)
      .useValue(fixtureClerkAuthService)
      .overrideProvider(CLERK_CLIENT)
      .useValue(fixtureClerkClient)
      .overrideProvider(PUSH_NOTIFICATION_PORT)
      .useValue({ sendToUsers })
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
        .get('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);

      const em = app.get(EntityManager).fork();
      const user = await em.findOneOrFail(User, {
        clerkUserId: TOKEN_TO_AUTH[token].userId,
      });
      localUserIdByToken.set(token, user.id);
    }
  });

  afterEach(() => {
    sendToUsers.mockClear();
  });

  afterAll(async () => {
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(AnnouncementRead, {
      announcement: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(AnnouncementRecipient, {
      announcement: { community: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(Announcement, {
      community: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(RecipientGroupMember, {
      recipientGroup: { group: { $in: createdGroupIds } },
    });
    await cleanup.nativeDelete(RecipientGroup, {
      group: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(RoleAssignment, {
      group: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(GroupMembership, {
      rootGroup: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(AuditLogEntry, {
      community: { $in: createdGroupIds },
    });
    await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
    await cleanup.nativeDelete(User, {
      clerkUserId: { $in: TEST_CLERK_USER_IDS },
    });
    await app.close();
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: `Announcements Test Org ${Date.now()}-${Math.random()}`,
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
      city: 'Poznań',
      region: 'Greater Poland',
      geonameId: 3088171,
      ...overrides,
    };
  }

  async function createGroup(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/groups')
        .set('Authorization', `Bearer ${token}`)
        .send(groupPayload(overrides))
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function createSection(
    token: string,
    parentGroupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${token}`)
        .send(
          groupPayload({
            name: `Announcements Test Section ${Date.now()}-${Math.random()}`,
            ...overrides,
          }),
        )
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function addMember(
    ownerToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole = GroupRole.MEMBER,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function findMembershipId(
    ownerToken: string,
    rootGroupId: string,
    userId: string | undefined,
  ): Promise<string> {
    const members = await bodyOf<{ id: string; user: { id: string } }[]>(
      request(app.getHttpServer())
        .get(`/api/v1/groups/${rootGroupId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .expect(200),
    );
    const membership = members.find((m) => m.user.id === userId);
    if (!membership) {
      throw new Error(`No membership found for user ${userId}`);
    }
    return membership.id;
  }

  async function grantRole(
    granterToken: string,
    groupId: string,
    membershipId: string,
    role: GroupRole = GroupRole.MEMBER,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ membershipId, role })
      .expect(201);
  }

  async function createOrgWithSection(): Promise<{
    org: GroupResponseDto;
    section: GroupResponseDto;
  }> {
    const org = await createGroup(OWNER_TOKEN);
    await addMember(OWNER_TOKEN, org.id, ADMIN_TOKEN, GroupRole.ADMIN);
    await addMember(OWNER_TOKEN, org.id, MEMBER_TOKEN, GroupRole.MEMBER);
    await addMember(
      OWNER_TOKEN,
      org.id,
      SECTION_MEMBER_TOKEN,
      GroupRole.MEMBER,
    );
    await addMember(OWNER_TOKEN, org.id, RECIPIENT_TOKEN, GroupRole.MEMBER);

    const section = await createSection(OWNER_TOKEN, org.id);
    const sectionMemberMembershipId = await findMembershipId(
      OWNER_TOKEN,
      org.id,
      localUserIdByToken.get(SECTION_MEMBER_TOKEN),
    );
    await grantRole(
      OWNER_TOKEN,
      section.id,
      sectionMemberMembershipId,
      GroupRole.MEMBER,
    );

    return { org, section };
  }

  function futureIso(daysFromNow = 30): string {
    return new Date(
      Date.now() + daysFromNow * 24 * 60 * 60 * 1000,
    ).toISOString();
  }

  function pastIso(): string {
    return new Date(Date.now() - 1000).toISOString();
  }

  function announcementPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      title: 'Ważne ogłoszenie',
      body: 'Treść ogłoszenia',
      isPinned: false,
      expiresAt: futureIso(),
      sendPushNotification: false,
      ...overrides,
    };
  }

  function createAnnouncement(
    token: string,
    communityGroupId: string,
    overrides: Record<string, unknown> = {},
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/groups/${communityGroupId}/announcements`)
      .set('Authorization', `Bearer ${token}`)
      .send(announcementPayload(overrides));
  }

  function createSectionAnnouncement(
    token: string,
    sectionId: string,
    overrides: Record<string, unknown> = {},
  ): request.Test {
    return request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/announcements`)
      .set('Authorization', `Bearer ${token}`)
      .send(announcementPayload(overrides));
  }

  describe('recipientType GROUP', () => {
    it('is visible to any active member of the Group, and not to an outsider', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'Group-wide notice',
        }).expect(201),
      );

      expect(created.recipientType).toBe('GROUP');
      expect(created.recipientGroupId).toBeNull();
      expect(created.isActive).toBe(true);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200);

      // Not a member of this Group at all - GroupPermissionsGuard rejects
      // with 404, never 403, so a non-member can't even confirm the Group
      // exists (same convention as every other Group-scoped endpoint).
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${OUTSIDER_TOKEN}`)
        .expect(404);
    });
  });

  describe('recipientType SECTION', () => {
    it('is visible only to members of that exact Section, not every root-org member', async () => {
      const { section } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createSectionAnnouncement(OWNER_TOKEN, section.id, {
          title: 'Section-only notice',
        }).expect(201),
      );

      expect(created.recipientType).toBe('SECTION');

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${SECTION_MEMBER_TOKEN}`)
        .expect(200);

      // MEMBER_TOKEN belongs to the root org but was never added to this
      // specific Section - must not see its Announcement (404, not 403 -
      // GroupPermissionsGuard never confirms a Section's existence to a
      // non-participant).
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
    });
  });

  describe('recipientType RECIPIENT_GROUP', () => {
    async function createRecipientGroupWith(
      org: GroupResponseDto,
      memberTokens: string[],
    ): Promise<RecipientGroupResponseDto> {
      return bodyOf<RecipientGroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/recipient-groups`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            name: `Trenerzy ${Date.now()}-${Math.random()}`,
            memberUserIds: memberTokens.map((t) => localUserIdByToken.get(t)),
          })
          .expect(201),
      );
    }

    it('is visible only to snapshot members, and remains the exact same audience after the Recipient Group changes later', async () => {
      const { org } = await createOrgWithSection();
      const recipientGroup = await createRecipientGroupWith(org, [
        RECIPIENT_TOKEN,
      ]);

      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'For trainers only',
          recipientGroupId: recipientGroup.id,
        }).expect(201),
      );
      expect(created.recipientType).toBe('RECIPIENT_GROUP');
      expect(created.recipientGroupId).toBe(recipientGroup.id);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${RECIPIENT_TOKEN}`)
        .expect(200);
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);

      // Add MEMBER_TOKEN to the Recipient Group *after* publish.
      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${org.id}/recipient-groups/${recipientGroup.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({
          name: recipientGroup.name,
          memberUserIds: [
            localUserIdByToken.get(RECIPIENT_TOKEN),
            localUserIdByToken.get(MEMBER_TOKEN),
          ],
        })
        .expect(200);

      // The already-published Announcement's audience must not change.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${RECIPIENT_TOKEN}`)
        .expect(200);
    });

    it('rejects an inactive Recipient Group as the recipient', async () => {
      const { org } = await createOrgWithSection();
      const recipientGroup = await createRecipientGroupWith(org, []);
      await request(app.getHttpServer())
        .post(
          `/api/v1/groups/${org.id}/recipient-groups/${recipientGroup.id}/deactivate`,
        )
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(201);

      await createAnnouncement(OWNER_TOKEN, org.id, {
        recipientGroupId: recipientGroup.id,
      }).expect(409);
    });
  });

  describe('validation', () => {
    it('rejects a missing or past expiresAt', async () => {
      const { org } = await createOrgWithSection();

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .send({ title: 'X', body: 'Y', isPinned: false })
        .expect(400);

      await createAnnouncement(OWNER_TOKEN, org.id, {
        expiresAt: pastIso(),
      }).expect(400);
    });

    it('only OWNER/ADMIN may create an Announcement', async () => {
      const { org } = await createOrgWithSection();
      await createAnnouncement(MEMBER_TOKEN, org.id).expect(403);
      await createAnnouncement(ADMIN_TOKEN, org.id).expect(201);
    });
  });

  describe('pinning and sorting', () => {
    it('allows any number of pinned Announcements, sorted pinned-first then newest-first within each group', async () => {
      const { org } = await createOrgWithSection();

      const first = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'Unpinned older',
          isPinned: false,
        }).expect(201),
      );
      const secondPinned = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'Pinned A',
          isPinned: true,
        }).expect(201),
      );
      const thirdPinned = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'Pinned B (newest pinned)',
          isPinned: true,
        }).expect(201),
      );
      const fourth = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'Unpinned newer',
          isPinned: false,
        }).expect(201),
      );

      const list = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );

      const ids = list.items.map((item) => item.id);
      expect(ids.slice(0, 2)).toEqual([thirdPinned.id, secondPinned.id]);
      expect(ids.slice(2, 4)).toEqual([fourth.id, first.id]);
    });
  });

  describe('expiry and archive', () => {
    it('an expired Announcement disappears from the active list and is only reachable through the OWNER/ADMIN archive', async () => {
      const { org } = await createOrgWithSection();
      const soonToExpire = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          title: 'Expiring soon',
          expiresAt: futureIso(1 / 86400), // ~1 second from now
        }).expect(201),
      );

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const activeList = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(activeList.items.some((item) => item.id === soonToExpire.id)).toBe(
        false,
      );

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${soonToExpire.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(200); // detail is not scoped to active-only, see getById

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/archive`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(403);

      const archive = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(archive.items.some((item) => item.id === soonToExpire.id)).toBe(
        true,
      );
    });
  });

  describe('edit', () => {
    it('updates title/body/pin/expiresAt, sets editedAt, and never re-sends a push', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id, {
          sendPushNotification: true,
        }).expect(201),
      );
      expect(created.editedAt).toBeNull();
      sendToUsers.mockClear();

      const updated = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            title: 'Updated title',
            body: 'Updated body',
            isPinned: true,
            expiresAt: futureIso(60),
          })
          .expect(200),
      );

      expect(updated.title).toBe('Updated title');
      expect(updated.isPinned).toBe(true);
      expect(updated.editedAt).not.toBeNull();
      expect(sendToUsers).not.toHaveBeenCalled();
    });
  });

  describe('delete', () => {
    it('is a soft delete - the Announcement disappears from the active list but survives in the archive', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id).expect(201),
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${OWNER_TOKEN}`)
        .expect(204);

      const activeList = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(activeList.items.some((item) => item.id === created.id)).toBe(
        false,
      );

      const archive = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/archive`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .expect(200),
      );
      expect(archive.items.some((item) => item.id === created.id)).toBe(true);
    });
  });

  describe('read tracking', () => {
    it('defaults to isRead: false, marks as read idempotently, and updates unreadCount', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(OWNER_TOKEN, org.id).expect(201),
      );

      const beforeRead = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(beforeRead.isRead).toBe(false);
      expect(beforeRead.readAt).toBeNull();

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${created.id}/read`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      // Idempotent - calling again must not error or duplicate.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${created.id}/read`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const em = app.get(EntityManager).fork();
      const readRows = await em.find(AnnouncementRead, {
        announcement: created.id,
        user: localUserIdByToken.get(MEMBER_TOKEN),
      });
      expect(readRows).toHaveLength(1);

      const afterRead = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(afterRead.isRead).toBe(true);
      expect(afterRead.readAt).not.toBeNull();

      // Fetching the list alone (by a different, still-unread member) must
      // never mark anything as read by itself.
      const otherMemberList = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements`)
          .set('Authorization', `Bearer ${RECIPIENT_TOKEN}`)
          .expect(200),
      );
      const otherMemberItem = otherMemberList.items.find(
        (item) => item.id === created.id,
      );
      expect(otherMemberItem?.isRead).toBe(false);
    });
  });

  describe('push notifications', () => {
    it('does not send when sendPushNotification is false', async () => {
      const { org } = await createOrgWithSection();
      await createAnnouncement(OWNER_TOKEN, org.id, {
        sendPushNotification: false,
      }).expect(201);

      expect(sendToUsers).not.toHaveBeenCalled();
    });

    it('sends to every current member except the author, deduplicated, when true', async () => {
      const { org } = await createOrgWithSection();
      await createAnnouncement(OWNER_TOKEN, org.id, {
        sendPushNotification: true,
      }).expect(201);

      expect(sendToUsers).toHaveBeenCalledTimes(1);
      const [recipientIds] = sendToUsers.mock.calls[0] as [string[], unknown];
      expect(new Set(recipientIds).size).toBe(recipientIds.length);
      expect(recipientIds).not.toContain(localUserIdByToken.get(OWNER_TOKEN));
      expect(recipientIds).toEqual(
        expect.arrayContaining([
          localUserIdByToken.get(ADMIN_TOKEN),
          localUserIdByToken.get(MEMBER_TOKEN),
        ]),
      );
    });

    it('sends only to the Recipient Group snapshot, never the whole community, for a RECIPIENT_GROUP Announcement', async () => {
      const { org } = await createOrgWithSection();
      const recipientGroup = await bodyOf<RecipientGroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/recipient-groups`)
          .set('Authorization', `Bearer ${OWNER_TOKEN}`)
          .send({
            name: `Push Test RG ${Date.now()}`,
            memberUserIds: [localUserIdByToken.get(RECIPIENT_TOKEN)],
          })
          .expect(201),
      );

      await createAnnouncement(OWNER_TOKEN, org.id, {
        recipientGroupId: recipientGroup.id,
        sendPushNotification: true,
      }).expect(201);

      expect(sendToUsers).toHaveBeenCalledTimes(1);
      const [recipientIds] = sendToUsers.mock.calls[0] as [string[], unknown];
      expect(recipientIds).toEqual([localUserIdByToken.get(RECIPIENT_TOKEN)]);
    });
  });
});
