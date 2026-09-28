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
 *  6. Expired Announcements disappear from the active list and can only be
 *     opened directly (detail, mark-as-read) by a viewer with archive
 *     access - never a plain member, even via a direct URL
 *  7. Editing sets `editedAt` only on a real content change; a no-op PATCH
 *     touches nothing
 *  8. Deleting sets a dedicated `deletedAt` marker, distinct from natural
 *     expiry - idempotent, and excludes the Announcement from every read
 *     path (active list, archive, detail, mark-as-read) rather than just
 *     downgrading it to "archived"
 *  9. Read tracking is persistent, idempotent, has its own `readAt`, and
 *     drives unreadCount - deleted Announcements never count
 * 10. Archive oversight overrides the Recipient Group snapshot rule - an
 *     OWNER/ADMIN with archive access can open/mark-read *any* expired
 *     Announcement in their community, even a RECIPIENT_GROUP one they were
 *     never a snapshot member of
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
import { AnnouncementResponseDto } from '../src/announcements/dto/announcement-response.dto';
import { AnnouncementListResult } from '../src/announcements/announcements.service';
import { Announcement } from '../src/announcements/entities/announcement.entity';
import { AnnouncementRecipient } from '../src/announcements/entities/announcement-recipient.entity';
import { AnnouncementRead } from '../src/announcements/entities/announcement-read.entity';
import { RecipientGroupResponseDto } from '../src/groups/dto/recipient-group-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { RecipientGroupMember } from '../src/groups/entities/recipient-group-member.entity';
import { RecipientGroup } from '../src/groups/entities/recipient-group.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { User } from '../src/users/entities/user.entity';

// No fixed "OWNER_TOKEN" here - GroupsService.create now allows at most one
// active FormalGroupAffiliation per user, and this file needs many
// independent Groups, so createGroup() mints a fresh, throwaway owner per
// call instead (see its own comment).
const ADMIN_TOKEN = 'valid-ann-admin-token';
const MEMBER_TOKEN = 'valid-ann-member-token';
const SECTION_MEMBER_TOKEN = 'valid-ann-section-member-token';
const RECIPIENT_TOKEN = 'valid-ann-recipient-token';
const OUTSIDER_TOKEN = 'valid-ann-outsider-token';

// Dedicated to the GET /announcements (global feed) describe block below -
// never touched by any other describe block in this file, so exact
// total/hasMore/ordering assertions there can't be polluted by
// Announcements created for unrelated tests earlier in the same run (this
// file's cleanup only runs once, in afterAll).
const GLOBAL_MEMBER_TOKEN = 'valid-ann-global-member-token';
const GLOBAL_SECTION_TOKEN = 'valid-ann-global-section-token';
const GLOBAL_RECIPIENT_TOKEN = 'valid-ann-global-recipient-token';
const GLOBAL_NONRECIPIENT_TOKEN = 'valid-ann-global-nonrecipient-token';
const GLOBAL_OUTSIDER_TOKEN = 'valid-ann-global-outsider-token';
const GLOBAL_PAGINATION_TOKEN = 'valid-ann-global-pagination-token';
const GLOBAL_TIEBREAK_TOKEN = 'valid-ann-global-tiebreak-token';

const TOKENS = [
  ADMIN_TOKEN,
  MEMBER_TOKEN,
  SECTION_MEMBER_TOKEN,
  RECIPIENT_TOKEN,
  OUTSIDER_TOKEN,
  GLOBAL_MEMBER_TOKEN,
  GLOBAL_SECTION_TOKEN,
  GLOBAL_RECIPIENT_TOKEN,
  GLOBAL_NONRECIPIENT_TOKEN,
  GLOBAL_OUTSIDER_TOKEN,
  GLOBAL_PAGINATION_TOKEN,
  GLOBAL_TIEBREAK_TOKEN,
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

  afterAll(async () => {
    await closeE2eApp(app, async () => {
      const cleanup = app.get(EntityManager).fork();
      const communityInIds = {
        $or: [
          { communityGroup: { $in: createdGroupIds } },
          { communitySection: { $in: createdGroupIds } },
        ],
      };
      await cleanup.nativeDelete(AnnouncementRead, {
        announcement: communityInIds,
      });
      await cleanup.nativeDelete(AnnouncementRecipient, {
        announcement: communityInIds,
      });
      await cleanup.nativeDelete(Announcement, communityInIds);
      await cleanup.nativeDelete(RecipientGroupMember, {
        recipientGroup: { group: { $in: createdGroupIds } },
      });
      await cleanup.nativeDelete(RecipientGroup, {
        $or: [
          { group: { $in: createdGroupIds } },
          { section: { $in: createdGroupIds } },
        ],
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
      // Sections must be removed before their parent Groups to satisfy the
      // parent_group_id foreign key (no cascade - see section.entity.ts).
      await cleanup.nativeDelete(Section, { id: { $in: createdGroupIds } });
      // Child Groups must be nulled before their parents to satisfy the
      // parent_group_id self-FK (no cascade - see group.entity.ts).
      await cleanup.nativeUpdate(
        Group,
        { id: { $in: createdGroupIds } },
        { parentGroup: null },
      );
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
      ...overrides,
    };
  }

  // No fixed "OWNER_TOKEN" as a Group creator anymore - GroupsService.create
  // now allows at most one active FormalGroupAffiliation per user (see
  // USER_ALREADY_HAS_FORMAL_GROUP), and this file needs many independent
  // Groups across its tests, so this mints a fresh, throwaway owner per
  // call instead (see createFreshGroupOwner's own comment). The returned
  // object carries the full GroupResponseDto directly (so `.id`/`.name`/...
  // keep working exactly as before) plus `.token`/`.userId` for callers
  // that need to act as its owner afterward.
  async function createGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'ann',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
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
            country: 'PL',
            city: 'Poznań',
            region: 'Greater Poland',
            geonameId: 3088171,
            ...overrides,
          }),
        )
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  // Group has no membership/MEMBER role at all (see the Membership/
  // RoleAssignments rebuild) - the only Roles it ever grants are
  // OWNER/ADMIN, via a direct RoleAssignment. Every "is this user
  // associated with the Group" fixture below uses ADMIN - view-tier
  // permissions (ANNOUNCEMENT_VIEW etc.) are identical between ADMIN and
  // OWNER on a Group, so this is sufficient for every test that just needs
  // "some associated user", not specifically the weakest tier.
  async function grantGroupRole(
    ownerToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole = GroupRole.ADMIN,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  // Section has real membership - joining always grants MEMBER atomically;
  // `role`, if given, grants that additional Role alongside it.
  async function addSectionMember(
    ownerToken: string,
    sectionId: string,
    memberToken: string,
    role?: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/members`)
      .set('Authorization', `Bearer ${ownerToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  // `org.token` (a fresh, throwaway owner - see createGroup's own comment)
  // is always included in the returned object, even where a caller only
  // destructures `{ section }`, so "act as this org's owner" is always
  // reachable via `org.token` for the rest of that test.
  async function createOrgWithSection(): Promise<{
    org: GroupResponseDto & { token: string; userId: string };
    section: GroupResponseDto;
  }> {
    const org = await createGroup();
    await grantGroupRole(org.token, org.id, ADMIN_TOKEN, GroupRole.ADMIN);
    await grantGroupRole(org.token, org.id, MEMBER_TOKEN, GroupRole.ADMIN);
    await grantGroupRole(
      org.token,
      org.id,
      SECTION_MEMBER_TOKEN,
      GroupRole.ADMIN,
    );
    await grantGroupRole(org.token, org.id, RECIPIENT_TOKEN, GroupRole.ADMIN);

    const section = await createSection(org.token, org.id);
    // SECTION_MEMBER_TOKEN additionally joins the Section itself - this is
    // what actually matters for the Section-scoped visibility tests below
    // (their Group-level ADMIN above grants nothing on the Section - no
    // inheritance).
    await addSectionMember(org.token, section.id, SECTION_MEMBER_TOKEN);

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
        createAnnouncement(org.token, org.id, {
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
      const { org, section } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createSectionAnnouncement(org.token, section.id, {
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
      org: GroupResponseDto & { token: string },
      memberTokens: string[],
    ): Promise<RecipientGroupResponseDto> {
      return bodyOf<RecipientGroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/recipient-groups`)
          .set('Authorization', `Bearer ${org.token}`)
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
        createAnnouncement(org.token, org.id, {
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
        .set('Authorization', `Bearer ${org.token}`)
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
        .set('Authorization', `Bearer ${org.token}`)
        .expect(201);

      await createAnnouncement(org.token, org.id, {
        recipientGroupId: recipientGroup.id,
      }).expect(409);
    });

    it('an OWNER/ADMIN with archive access can open and mark-read an expired RECIPIENT_GROUP Announcement even when they were never in its snapshot', async () => {
      const { org } = await createOrgWithSection();
      // org.token is deliberately excluded from the Recipient Group -
      // regression test for the archive oversight rule: archive access
      // must never require snapshot membership too (see assertReadable).
      const recipientGroup = await createRecipientGroupWith(org, [
        RECIPIENT_TOKEN,
      ]);
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Owner never a recipient',
          recipientGroupId: recipientGroup.id,
          expiresAt: futureIso(1 / 86400),
        }).expect(201),
      );

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const archive = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/archive`)
          .set('Authorization', `Bearer ${org.token}`)
          .expect(200),
      );
      expect(archive.items.some((item) => item.id === created.id)).toBe(true);

      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${created.id}/read`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(204);
    });
  });

  describe('validation', () => {
    it('rejects a missing or past expiresAt', async () => {
      const { org } = await createOrgWithSection();

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements`)
        .set('Authorization', `Bearer ${org.token}`)
        .send({ title: 'X', body: 'Y', isPinned: false })
        .expect(400);

      await createAnnouncement(org.token, org.id, {
        expiresAt: pastIso(),
      }).expect(400);
    });

    it('only OWNER/ADMIN may create an Announcement - a Group has no lower tier at all, so this is exercised on a Section, where MEMBER is a real, distinct Role', async () => {
      const { org, section } = await createOrgWithSection();
      // SECTION_MEMBER_TOKEN holds only the base MEMBER Role on the
      // Section (see createOrgWithSection) - ANNOUNCEMENT_VIEW, not
      // ANNOUNCEMENT_MANAGE.
      await createSectionAnnouncement(SECTION_MEMBER_TOKEN, section.id).expect(
        403,
      );
      // ADMIN_TOKEN holds Group-level ADMIN only - granting Section ADMIN
      // separately proves the Section's own Role, not the Group's, is what
      // authorizes creation here (no inheritance).
      await addSectionMember(
        org.token,
        section.id,
        ADMIN_TOKEN,
        GroupRole.ADMIN,
      );
      await createSectionAnnouncement(ADMIN_TOKEN, section.id).expect(201);

      // OWNER/ADMIN on the Group itself still works the same as before.
      await createAnnouncement(ADMIN_TOKEN, org.id).expect(201);
    });

    it('sendPushNotification is not part of the public contract - sending it has no visible effect and the response never echoes it', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<Record<string, unknown>>(
        createAnnouncement(org.token, org.id, {
          sendPushNotification: true,
        }).expect(201),
      );
      expect(created).not.toHaveProperty('sendPushNotification');
    });
  });

  describe('pinning and sorting', () => {
    it('allows any number of pinned Announcements, sorted pinned-first then newest-first within each group', async () => {
      const { org } = await createOrgWithSection();

      const first = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Unpinned older',
          isPinned: false,
        }).expect(201),
      );
      const secondPinned = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Pinned A',
          isPinned: true,
        }).expect(201),
      );
      const thirdPinned = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Pinned B (newest pinned)',
          isPinned: true,
        }).expect(201),
      );
      const fourth = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Unpinned newer',
          isPinned: false,
        }).expect(201),
      );

      const list = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements`)
          .set('Authorization', `Bearer ${org.token}`)
          .expect(200),
      );

      const ids = list.items.map((item) => item.id);
      expect(ids.slice(0, 2)).toEqual([thirdPinned.id, secondPinned.id]);
      expect(ids.slice(2, 4)).toEqual([fourth.id, first.id]);
    });
  });

  describe('expiry and archive', () => {
    // A Group only ever has OWNER/ADMIN (both of which hold
    // ANNOUNCEMENT_ARCHIVE_VIEW - see group-role-permissions.map.ts), so
    // there is no "plain viewer without archive access" tier for a
    // Group-scoped Announcement anymore - this is exercised on the Section
    // instead, where MEMBER is a real, distinct, lesser Role.
    it('an expired Announcement disappears from the active list, cannot be opened directly by a plain Section member, but is reachable via detail and the archive by its OWNER', async () => {
      const { org, section } = await createOrgWithSection();
      const soonToExpire = await bodyOf<AnnouncementResponseDto>(
        createSectionAnnouncement(org.token, section.id, {
          title: 'Expiring soon',
          expiresAt: futureIso(1 / 86400), // ~1 second from now
        }).expect(201),
      );

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const activeList = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/announcements`)
          .set('Authorization', `Bearer ${SECTION_MEMBER_TOKEN}`)
          .expect(200),
      );
      expect(activeList.items.some((item) => item.id === soonToExpire.id)).toBe(
        false,
      );

      // A plain member cannot open an expired Announcement directly, even
      // by URL - only archive-permitted OWNER/ADMIN can (task requirement).
      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/announcements/${soonToExpire.id}`)
        .set('Authorization', `Bearer ${SECTION_MEMBER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/announcements/${soonToExpire.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/api/v1/sections/${section.id}/announcements/archive`)
        .set('Authorization', `Bearer ${SECTION_MEMBER_TOKEN}`)
        .expect(403);

      const archive = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/sections/${section.id}/announcements/archive`)
          .set('Authorization', `Bearer ${org.token}`)
          .expect(200),
      );
      expect(archive.items.some((item) => item.id === soonToExpire.id)).toBe(
        true,
      );
    });

    it('a plain Section member cannot mark an expired Announcement as read, but its OWNER with archive access can', async () => {
      const { org, section } = await createOrgWithSection();
      const soonToExpire = await bodyOf<AnnouncementResponseDto>(
        createSectionAnnouncement(org.token, section.id, {
          title: 'Expiring soon for read test',
          expiresAt: futureIso(1 / 86400),
        }).expect(201),
      );

      await new Promise((resolve) => setTimeout(resolve, 1100));

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/announcements/${soonToExpire.id}/read`,
        )
        .set('Authorization', `Bearer ${SECTION_MEMBER_TOKEN}`)
        .expect(404);

      await request(app.getHttpServer())
        .post(
          `/api/v1/sections/${section.id}/announcements/${soonToExpire.id}/read`,
        )
        .set('Authorization', `Bearer ${org.token}`)
        .expect(204);
    });
  });

  describe('edit', () => {
    it('a new Announcement has editedAt: null', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
      );
      expect(created.editedAt).toBeNull();
    });

    it('a real content change updates title/body/pin/expiresAt and sets editedAt', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
      );

      const updated = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${org.token}`)
          .send({
            title: 'Updated title',
            body: 'Updated body',
            isPinned: true,
            isImportant: false,
            expiresAt: futureIso(60),
          })
          .expect(200),
      );

      expect(updated.title).toBe('Updated title');
      expect(updated.isPinned).toBe(true);
      expect(updated.editedAt).not.toBeNull();
    });

    it('a no-op PATCH (identical values) leaves editedAt untouched', async () => {
      const { org } = await createOrgWithSection();
      const payload = announcementPayload({ title: 'Stable title' });
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, payload).expect(201),
      );
      expect(created.editedAt).toBeNull();

      const patched = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${org.token}`)
          .send({
            title: payload.title,
            body: payload.body,
            isPinned: payload.isPinned,
            isImportant: created.isImportant,
            expiresAt: created.expiresAt,
          })
          .expect(200),
      );

      expect(patched.editedAt).toBeNull();
      expect(patched.updatedAt).toBe(created.updatedAt);
    });

    it('marking as read does not set editedAt', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
      );

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${created.id}/read`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(204);

      const afterRead = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${org.token}`)
          .expect(200),
      );
      expect(afterRead.editedAt).toBeNull();
    });

    it('cannot change the recipient - PATCH accepts no recipient-related field', async () => {
      const { org } = await createOrgWithSection();
      const recipientGroup = await bodyOf<RecipientGroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/recipient-groups`)
          .set('Authorization', `Bearer ${org.token}`)
          .send({
            name: `Edit Recipient Test ${Date.now()}`,
            memberUserIds: [localUserIdByToken.get(RECIPIENT_TOKEN)],
          })
          .expect(201),
      );
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          recipientGroupId: recipientGroup.id,
        }).expect(201),
      );

      const updated = await bodyOf<AnnouncementResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/groups/${org.id}/announcements/${created.id}`)
          .set('Authorization', `Bearer ${org.token}`)
          .send({
            title: 'Still trainers only',
            body: created.body,
            isPinned: created.isPinned,
            isImportant: created.isImportant,
            expiresAt: created.expiresAt,
            // Extra fields a malicious/confused client might try to send -
            // the schema has no such fields at all, so these are silently
            // stripped rather than applied.
            recipientType: 'GROUP',
            recipientGroupId: null,
          })
          .expect(200),
      );

      expect(updated.recipientType).toBe('RECIPIENT_GROUP');
      expect(updated.recipientGroupId).toBe(recipientGroup.id);

      // The snapshot itself is untouched - still only the original recipient.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${MEMBER_TOKEN}`)
        .expect(404);
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${RECIPIENT_TOKEN}`)
        .expect(200);
    });
  });

  describe('delete', () => {
    it('sets a dedicated deleted state - distinct from expiry, and excluded from every standard read path', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
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

      // Deleted is not "archived" - it must not appear in the expired
      // archive either, even for an OWNER/ADMIN (task requirement: a
      // deleted Announcement is not the same thing as a naturally-expired
      // one, and must never surface through the archive as if it were).
      const archive = await bodyOf<AnnouncementListResult>(
        request(app.getHttpServer())
          .get(`/api/v1/groups/${org.id}/announcements/archive`)
          .set('Authorization', `Bearer ${org.token}`)
          .expect(200),
      );
      expect(archive.items.some((item) => item.id === created.id)).toBe(false);

      // Not even the OWNER can open it directly anymore.
      await request(app.getHttpServer())
        .get(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(404);

      // Cannot be marked as read once deleted.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${created.id}/read`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(404);
    });

    it('is idempotent - deleting an already-deleted Announcement is a no-op success', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
      );

      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(204);
      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(204);
    });

    it('cannot be un-deleted by changing expiresAt - PATCH on a deleted Announcement 404s, exactly like a nonexistent one', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
      );
      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(204);

      await request(app.getHttpServer())
        .patch(`/api/v1/groups/${org.id}/announcements/${created.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .send({
          title: created.title,
          body: created.body,
          isPinned: created.isPinned,
          isImportant: created.isImportant,
          expiresAt: futureIso(90),
        })
        .expect(404);
    });
  });

  describe('read tracking', () => {
    it('defaults to isRead: false, marks as read idempotently, and updates unreadCount', async () => {
      const { org } = await createOrgWithSection();
      const created = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id).expect(201),
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

  describe('GET /announcements (global feed)', () => {
    async function createRecipientGroup(
      org: { id: string; token: string },
      memberTokens: string[],
    ): Promise<RecipientGroupResponseDto> {
      return bodyOf<RecipientGroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/recipient-groups`)
          .set('Authorization', `Bearer ${org.token}`)
          .send({
            name: `Global feed recipients ${Date.now()}-${Math.random()}`,
            memberUserIds: memberTokens.map((t) => localUserIdByToken.get(t)),
          })
          .expect(201),
      );
    }

    function getGlobalFeed(token: string, qs = ''): request.Test {
      return request(app.getHttpServer())
        .get(`/api/v1/announcements${qs}`)
        .set('Authorization', `Bearer ${token}`);
    }

    it('returns 401 without a session', async () => {
      await request(app.getHttpServer())
        .get('/api/v1/announcements')
        .expect(401);
    });

    it('aggregates active Announcements from every Group/Section the caller belongs to, excluding communities they do not', async () => {
      const orgA = await createGroup();
      await grantGroupRole(orgA.token, orgA.id, GLOBAL_MEMBER_TOKEN);
      const sectionA = await createSection(orgA.token, orgA.id);
      // GLOBAL_MEMBER_TOKEN is a root-org member of orgA only - never added
      // to sectionA, so a Section-scoped Announcement there must not leak
      // into their global feed.

      const orgB = await createGroup();
      await grantGroupRole(orgB.token, orgB.id, GLOBAL_MEMBER_TOKEN);

      const annA = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(orgA.token, orgA.id, {
          title: 'Global feed - org A',
        }).expect(201),
      );
      const annSectionA = await bodyOf<AnnouncementResponseDto>(
        createSectionAnnouncement(orgA.token, sectionA.id, {
          title: 'Global feed - section A (not a member)',
        }).expect(201),
      );
      const annB = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(orgB.token, orgB.id, {
          title: 'Global feed - org B',
        }).expect(201),
      );

      const memberFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_MEMBER_TOKEN).expect(200),
      );
      const memberIds = memberFeed.items.map((item) => item.id);
      expect(memberIds).toEqual(expect.arrayContaining([annA.id, annB.id]));
      expect(memberIds).not.toContain(annSectionA.id);
      expect(memberFeed.total).toBe(2);
      expect(memberFeed.hasMore).toBe(false);

      // A Section member sees the root org's Announcement *and* their own
      // Section's, but not the unrelated org B they were never added to.
      await grantGroupRole(orgA.token, orgA.id, GLOBAL_SECTION_TOKEN);
      await addSectionMember(orgA.token, sectionA.id, GLOBAL_SECTION_TOKEN);
      const sectionFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_SECTION_TOKEN).expect(200),
      );
      const sectionIds = sectionFeed.items.map((item) => item.id);
      expect(sectionIds).toEqual(
        expect.arrayContaining([annA.id, annSectionA.id]),
      );
      expect(sectionIds).not.toContain(annB.id);

      // An outsider with no membership anywhere sees nothing.
      const outsiderFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_OUTSIDER_TOKEN).expect(200),
      );
      expect(outsiderFeed.items).toHaveLength(0);
      expect(outsiderFeed.total).toBe(0);
      expect(outsiderFeed.hasMore).toBe(false);
    });

    it('applies the exact same Recipient Group snapshot rule as the per-community list', async () => {
      const org = await createGroup();
      await grantGroupRole(org.token, org.id, GLOBAL_RECIPIENT_TOKEN);
      await grantGroupRole(org.token, org.id, GLOBAL_NONRECIPIENT_TOKEN);
      const recipientGroup = await createRecipientGroup(org, [
        GLOBAL_RECIPIENT_TOKEN,
      ]);

      const announcement = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Global feed - recipient group only',
          recipientGroupId: recipientGroup.id,
        }).expect(201),
      );

      const recipientFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_RECIPIENT_TOKEN).expect(200),
      );
      expect(recipientFeed.items.map((item) => item.id)).toContain(
        announcement.id,
      );

      const nonRecipientFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_NONRECIPIENT_TOKEN).expect(200),
      );
      expect(nonRecipientFeed.items.map((item) => item.id)).not.toContain(
        announcement.id,
      );
    });

    it('never includes an expired or soft-deleted Announcement', async () => {
      const org = await createGroup();
      await grantGroupRole(org.token, org.id, GLOBAL_RECIPIENT_TOKEN);

      const toExpire = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Global feed - will expire',
          expiresAt: futureIso(1 / 86400),
        }).expect(201),
      );
      const toDelete = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Global feed - will be deleted',
        }).expect(201),
      );
      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/announcements/${toDelete.id}`)
        .set('Authorization', `Bearer ${org.token}`)
        .expect(204);

      await new Promise((resolve) => setTimeout(resolve, 1100));

      const feed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_RECIPIENT_TOKEN).expect(200),
      );
      const ids = feed.items.map((item) => item.id);
      expect(ids).not.toContain(toExpire.id);
      expect(ids).not.toContain(toDelete.id);
    });

    it('sets communityResourceType to GROUP for a root-Group Announcement and SECTION for a Section Announcement', async () => {
      const org = await createGroup();
      await grantGroupRole(org.token, org.id, GLOBAL_SECTION_TOKEN);
      const section = await createSection(org.token, org.id);
      await addSectionMember(org.token, section.id, GLOBAL_SECTION_TOKEN);

      const groupAnnouncement = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Global feed - resource type GROUP',
        }).expect(201),
      );
      const sectionAnnouncement = await bodyOf<AnnouncementResponseDto>(
        createSectionAnnouncement(org.token, section.id, {
          title: 'Global feed - resource type SECTION',
        }).expect(201),
      );

      const feed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_SECTION_TOKEN).expect(200),
      );
      const byId = new Map(feed.items.map((item) => [item.id, item]));
      expect(byId.get(groupAnnouncement.id)?.communityResourceType).toBe(
        'GROUP',
      );
      expect(byId.get(sectionAnnouncement.id)?.communityResourceType).toBe(
        'SECTION',
      );
    });

    it('sorts pinned-first then newest-first, supports unreadOnly, and paginates with a correct total/hasMore', async () => {
      const org = await createGroup();
      await grantGroupRole(org.token, org.id, GLOBAL_PAGINATION_TOKEN);

      const oldest = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, { title: 'Oldest' }).expect(201),
      );
      const older = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, { title: 'Older' }).expect(201),
      );
      const pinned = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Pinned',
          isPinned: true,
        }).expect(201),
      );
      const newest = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, { title: 'Newest' }).expect(201),
      );

      // Default sort: pinned first, then newest-first among the rest.
      const fullFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_PAGINATION_TOKEN, '?limit=100').expect(200),
      );
      expect(fullFeed.items.map((item) => item.id)).toEqual([
        pinned.id,
        newest.id,
        older.id,
        oldest.id,
      ]);
      expect(fullFeed.total).toBe(4);
      expect(fullFeed.hasMore).toBe(false);

      // Pagination: limit=2/offset=0 is a page with more after it;
      // limit=2/offset=2 is the last page.
      const page1 = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_PAGINATION_TOKEN, '?limit=2&offset=0').expect(200),
      );
      expect(page1.items.map((item) => item.id)).toEqual([
        pinned.id,
        newest.id,
      ]);
      expect(page1.total).toBe(4);
      expect(page1.hasMore).toBe(true);

      const page2 = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_PAGINATION_TOKEN, '?limit=2&offset=2').expect(200),
      );
      expect(page2.items.map((item) => item.id)).toEqual([older.id, oldest.id]);
      expect(page2.total).toBe(4);
      expect(page2.hasMore).toBe(false);

      // unreadOnly: mark two as read, expect the other two back, with a
      // total that reflects only the still-unread set.
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${pinned.id}/read`)
        .set('Authorization', `Bearer ${GLOBAL_PAGINATION_TOKEN}`)
        .expect(204);
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/announcements/${newest.id}/read`)
        .set('Authorization', `Bearer ${GLOBAL_PAGINATION_TOKEN}`)
        .expect(204);

      const unreadFeed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_PAGINATION_TOKEN, '?unreadOnly=true').expect(200),
      );
      expect(unreadFeed.items.map((item) => item.id)).toEqual([
        older.id,
        oldest.id,
      ]);
      expect(unreadFeed.total).toBe(2);
      expect(unreadFeed.hasMore).toBe(false);
    });

    it('rejects limit > 100 and a negative offset', async () => {
      await getGlobalFeed(GLOBAL_PAGINATION_TOKEN, '?limit=101').expect(400);
      await getGlobalFeed(GLOBAL_PAGINATION_TOKEN, '?offset=-1').expect(400);
    });

    it('breaks a createdAt tie deterministically by id DESC', async () => {
      const org = await createGroup();
      await grantGroupRole(org.token, org.id, GLOBAL_TIEBREAK_TOKEN);

      const first = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Tiebreak A',
        }).expect(201),
      );
      const second = await bodyOf<AnnouncementResponseDto>(
        createAnnouncement(org.token, org.id, {
          title: 'Tiebreak B',
        }).expect(201),
      );

      // Force an exact createdAt tie - without a deterministic tie-breaker,
      // Postgres could return these two in either order, or in a different
      // order across two otherwise-identical requests.
      const em = app.get(EntityManager).fork();
      const tiedCreatedAt = new Date();
      await em.nativeUpdate(
        Announcement,
        { id: { $in: [first.id, second.id] } },
        { createdAt: tiedCreatedAt },
      );

      const expectedFirst = first.id > second.id ? first.id : second.id;
      const expectedSecond = first.id > second.id ? second.id : first.id;

      const feed = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_TIEBREAK_TOKEN).expect(200),
      );
      expect(feed.items.map((item) => item.id)).toEqual([
        expectedFirst,
        expectedSecond,
      ]);

      // Deterministic across repeated calls, not just accidentally stable.
      const feedAgain = await bodyOf<AnnouncementListResult>(
        getGlobalFeed(GLOBAL_TIEBREAK_TOKEN).expect(200),
      );
      expect(feedAgain.items.map((item) => item.id)).toEqual([
        expectedFirst,
        expectedSecond,
      ]);
    });
  });
});
