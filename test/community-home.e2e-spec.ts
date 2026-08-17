/**
 * E2E tests for GET /community/home (Community Home dashboard - PAD-001 §10).
 *
 * Under the Membership/RoleAssignments rebuild, `myCommunities` is built
 * purely from RoleAssignments the caller directly holds (see
 * CommunityHomeService.buildParticipation) - a Group has no membership at
 * all (only OWNER/ADMIN via direct grant/transfer), and joining a Section
 * never adds its parent Group to the list (no inheritance in either
 * direction). Capability fields are split into `...GroupIds`/`...SectionIds`
 * pairs (see CommunityHomeCapabilitiesDto) rather than one mixed list.
 *
 * Scenarios:
 *  1. Unauthenticated request → 401
 *  2. Brand new user → empty dashboard with correct default capabilities
 *  3. A user holding ADMIN on several Groups → every one appears in
 *     myCommunities
 *  4. A user holding several Roles on the same Section → myRoles is an
 *     array containing all of them (never collapsed to one `role`)
 *  5. Joining only a Section never adds its parent Group to myCommunities
 *     at all (no derived participation - stricter than the old model)
 *  6. The caller sees their own pending invitations (Section-scoped - a
 *     Group has no invitation flow)
 *  7. The caller never sees another user's pending invitations
 *  8. A caller with GROUP_JOIN_REQUEST_REVIEW on a Section sees its
 *     pending join requests
 *  9. A plain MEMBER of the same Section does not see its join requests
 *     (role name is not assumed sufficient - resolved via GroupPermissionService)
 * 10. A hidden (isHidden=true) Section is fully visible to its own member,
 *     but leaks nothing to an unrelated outsider
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
import { CommunityHomeResponseDto } from '../src/groups/dto/community-home-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { MembershipRequest } from '../src/groups/entities/membership-request.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { User } from '../src/users/entities/user.entity';

const TOKENS = [
  'ch-owner',
  'ch-member',
  'ch-admin',
  'ch-outsider',
  'ch-invitee',
  'ch-newuser',
  'ch-section-member',
] as const;

const TOKEN_TO_AUTH: Record<string, AuthContext> = {};
const FIXTURE_CLERK_PROFILES: Record<
  string,
  { imageUrl: string; primaryEmailAddress: { emailAddress: string } | null }
> = {};

for (const name of TOKENS) {
  const token = `valid-${name}-token`;
  const clerkId = `user_test_${name.replace(/-/g, '_')}`;
  TOKEN_TO_AUTH[token] = {
    userId: clerkId,
    sessionId: `sess_${name}`,
    tokenType: 'session_token',
    claims: { sub: clerkId, sid: `sess_${name}` },
  };
  FIXTURE_CLERK_PROFILES[clerkId] = {
    imageUrl: `https://img.clerk.com/${name}.png`,
    primaryEmailAddress: { emailAddress: `${name}@example.com` },
  };
}

function tokenFor(name: (typeof TOKENS)[number]): string {
  return `valid-${name}-token`;
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

describe('Community Home (e2e)', () => {
  let app: INestApplication<App>;
  const createdGroupIds: string[] = [];
  const createdSectionIds: string[] = [];
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
      const allTargetIds = [...createdGroupIds, ...createdSectionIds];
      await cleanup.nativeDelete(MembershipRequest, {
        $or: [
          { targetGroup: { $in: allTargetIds } },
          { targetSection: { $in: allTargetIds } },
        ],
      });
      await cleanup.nativeDelete(RoleAssignment, {
        $or: [
          { group: { $in: allTargetIds } },
          { section: { $in: allTargetIds } },
        ],
      });
      await cleanup.nativeDelete(SectionMembership, {
        section: { $in: createdSectionIds },
      });
      await cleanup.nativeDelete(AuditLogEntry, {
        $or: [
          { group: { $in: allTargetIds } },
          { section: { $in: allTargetIds } },
        ],
      });
      // Sections must be removed before their parent Groups to satisfy the
      // parent_group_id foreign key (no cascade - see section.entity.ts).
      await cleanup.nativeDelete(Section, { id: { $in: createdSectionIds } });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      await cleanup.nativeDelete(User, {
        clerkUserId: { $in: TEST_CLERK_USER_IDS },
      });
    });
  });

  function groupPayload(
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      name: 'Community Home Test Org',
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
      ...overrides,
    };
  }

  async function createRootGroup(
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
    ownerToken: string,
    parentGroupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SectionResponseDto> {
    const created = await bodyOf<SectionResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Community Home Test Section',
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
        })
        .expect(201),
    );
    createdSectionIds.push(created.id);
    return created;
  }

  // Admin-driven add (not self-service join) - mirrors the old addMember
  // helper, now against a Section (Group has no members at all).
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

  async function grantGroupRole(
    granterToken: string,
    groupId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function grantSectionRole(
    granterToken: string,
    sectionId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/sections/${sectionId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ userId: localUserIdByToken.get(memberToken), role })
      .expect(201);
  }

  async function getHome(token: string): Promise<CommunityHomeResponseDto> {
    return bodyOf<CommunityHomeResponseDto>(
      request(app.getHttpServer())
        .get('/api/v1/community/home')
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  it('returns 401 for an unauthenticated request', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/community/home')
      .expect(401);
  });

  it('returns an empty dashboard with correct default capabilities for a brand new user', async () => {
    const home = await getHome(tokenFor('ch-newuser'));

    expect(home.myCommunities).toEqual([]);
    expect(home.pendingInvitations).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    expect(home.pendingJoinRequests).toEqual({
      items: [],
      total: 0,
      hasMore: false,
    });
    expect(home.summary).toEqual({
      communitiesCount: 0,
      pendingInvitationsCount: 0,
      pendingJoinRequestsCount: 0,
      actionableItemsCount: 0,
    });
    expect(home.capabilities).toEqual({
      canCreateGroup: true,
      canCreateStandaloneSection: true,
      canCreateSectionInGroupIds: [],
      canCreateSectionInSectionIds: [],
      canCreateEventInGroupIds: [],
      canCreateEventInSectionIds: [],
      canReviewJoinRequestsInSectionIds: [],
      canViewMembersInSectionIds: [],
      canManageMembersInSectionIds: [],
      canInviteMembersInSectionIds: [],
      canManageInvitationsInSectionIds: [],
      canBanMembersInSectionIds: [],
      canSuspendMembersInSectionIds: [],
      canManageRolesInGroupIds: [],
      canManageRolesInSectionIds: [],
      canTransferOwnershipInGroupIds: [],
      canTransferOwnershipInSectionIds: [],
      canArchiveGroupIds: [],
      canArchiveSectionIds: [],
      canRestoreGroupIds: [],
      canRestoreSectionIds: [],
      canDeleteGroupIds: [],
      canDeleteSectionIds: [],
      canViewAuditLogInGroupIds: [],
      canViewAuditLogInSectionIds: [],
      canManageNotificationsInSectionIds: [],
      canManageAnnouncementsInGroupIds: [],
      canManageAnnouncementsInSectionIds: [],
      canViewAnnouncementArchiveInGroupIds: [],
      canViewAnnouncementArchiveInSectionIds: [],
      canViewRecipientGroupsInGroupIds: [],
      canViewRecipientGroupsInSectionIds: [],
      canManageRecipientGroupsInGroupIds: [],
      canManageRecipientGroupsInSectionIds: [],
      canManageAnyCommunity: false,
    });
  });

  describe('My Communities', () => {
    it('lists every Group the user holds ADMIN on (Group has no MEMBER role - it is administered only via OWNER/ADMIN)', async () => {
      const orgOne = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Cordão de Ouro',
      });
      const orgTwo = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Abadá',
      });
      await grantGroupRole(
        tokenFor('ch-owner'),
        orgOne.id,
        tokenFor('ch-member'),
        GroupRole.ADMIN,
      );
      await grantGroupRole(
        tokenFor('ch-owner'),
        orgTwo.id,
        tokenFor('ch-member'),
        GroupRole.ADMIN,
      );

      const home = await getHome(tokenFor('ch-member'));

      expect(home.myCommunities).toHaveLength(2);
      const orgOneEntry = home.myCommunities.find((c) => c.id === orgOne.id);
      const orgTwoEntry = home.myCommunities.find((c) => c.id === orgTwo.id);
      expect(orgOneEntry).toMatchObject({
        isGroup: true,
        myRoles: ['ADMIN'],
      });
      expect(orgTwoEntry).toMatchObject({
        isGroup: true,
        myRoles: ['ADMIN'],
      });
      expect(home.summary.communitiesCount).toBe(2);
    });

    it('preserves multiple Roles held on the same Section as an array, never collapsed to one `role`', async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Cordão de Ouro (multi-role Section test)',
      });
      const section = await createSection(tokenFor('ch-owner'), org.id, {
        name: 'Multi-role Section',
      });
      await addSectionMember(
        tokenFor('ch-owner'),
        section.id,
        tokenFor('ch-member'),
      );
      await grantSectionRole(
        tokenFor('ch-owner'),
        section.id,
        tokenFor('ch-member'),
        GroupRole.INSTRUCTOR,
      );

      const home = await getHome(tokenFor('ch-member'));

      const sectionEntry = home.myCommunities.find((c) => c.id === section.id);
      expect(sectionEntry?.isGroup).toBe(false);
      expect([...(sectionEntry?.myRoles ?? [])].sort()).toEqual(
        ['INSTRUCTOR', 'MEMBER'].sort(),
      );
    });

    // No inheritance in either direction: joining a Section never adds its
    // parent Group to myCommunities - a Role held on a Section has zero
    // effect on the Group above it (a Group has no membership to derive
    // anything from in the first place).
    it('joining only a Section never adds its parent Group to myCommunities at all', async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Cordão de Ouro (Section-only test)',
      });
      const section = await createSection(tokenFor('ch-owner'), org.id, {
        name: 'Poznań',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${tokenFor('ch-section-member')}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      const home = await getHome(tokenFor('ch-section-member'));

      expect(home.myCommunities).toHaveLength(1);
      const orgEntry = home.myCommunities.find((c) => c.id === org.id);
      const sectionEntry = home.myCommunities.find((c) => c.id === section.id);
      expect(orgEntry).toBeUndefined();
      expect(sectionEntry).toMatchObject({
        isGroup: false,
        parentId: org.id,
        myRoles: ['MEMBER'],
      });
    });
  });

  describe('Pending Invitations', () => {
    it("shows the caller's own pending invitation and never another user's - Section-scoped, Group has no invitation flow", async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Invitation Test Org',
      });
      const section = await createSection(tokenFor('ch-owner'), org.id, {
        name: 'Invitation Test Section',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/invitations`)
        .set('Authorization', `Bearer ${tokenFor('ch-owner')}`)
        .send({
          targetType: 'SECTION',
          invitedUserId: localUserIdByToken.get(tokenFor('ch-invitee')),
        })
        .expect(201);

      const inviteeHome = await getHome(tokenFor('ch-invitee'));
      expect(inviteeHome.pendingInvitations.total).toBe(1);
      expect(inviteeHome.pendingInvitations.items[0].community).toMatchObject({
        id: section.id,
        name: 'Invitation Test Section',
        isGroup: false,
      });
      expect(inviteeHome.summary.pendingInvitationsCount).toBe(1);
      expect(inviteeHome.summary.actionableItemsCount).toBe(
        inviteeHome.summary.pendingInvitationsCount +
          inviteeHome.summary.pendingJoinRequestsCount,
      );

      const outsiderHome = await getHome(tokenFor('ch-outsider'));
      expect(
        outsiderHome.pendingInvitations.items.some(
          (invitation) => invitation.community.id === section.id,
        ),
      ).toBe(false);
    });
  });

  describe('Pending Join Requests', () => {
    it('are visible to a caller with GROUP_JOIN_REQUEST_REVIEW on a Section, and hidden from a plain MEMBER of the very same Section', async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Join Request Test Org',
      });
      // The Section creator (ch-owner) automatically becomes its OWNER -
      // no separate grant needed for the review-capability assertion below.
      const section = await createSection(tokenFor('ch-owner'), org.id, {
        name: 'Join Request Test Section',
        isPublic: false,
      });
      await addSectionMember(
        tokenFor('ch-owner'),
        section.id,
        tokenFor('ch-member'),
      );
      await addSectionMember(
        tokenFor('ch-owner'),
        section.id,
        tokenFor('ch-admin'),
        GroupRole.ADMIN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      const ownerHome = await getHome(tokenFor('ch-owner'));
      expect(
        ownerHome.capabilities.canReviewJoinRequestsInSectionIds,
      ).toContain(section.id);
      const ownerJoinRequest = ownerHome.pendingJoinRequests.items.find(
        (item) => item.community.id === section.id,
      );
      expect(ownerJoinRequest).toBeDefined();

      const adminHome = await getHome(tokenFor('ch-admin'));
      expect(
        adminHome.capabilities.canReviewJoinRequestsInSectionIds,
      ).toContain(section.id);
      expect(
        adminHome.pendingJoinRequests.items.some(
          (item) => item.community.id === section.id,
        ),
      ).toBe(true);

      const memberHome = await getHome(tokenFor('ch-member'));
      expect(
        memberHome.capabilities.canReviewJoinRequestsInSectionIds,
      ).not.toContain(section.id);
      expect(
        memberHome.pendingJoinRequests.items.some(
          (item) => item.community.id === section.id,
        ),
      ).toBe(false);
    });
  });

  describe('Hidden communities', () => {
    it('a hidden Section is fully visible to its own member but leaks nothing to an unrelated outsider', async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Hidden Org',
      });
      const hiddenSection = await createSection(tokenFor('ch-owner'), org.id, {
        name: 'Hidden Section',
        isHidden: true,
      });
      await addSectionMember(
        tokenFor('ch-owner'),
        hiddenSection.id,
        tokenFor('ch-member'),
      );

      const memberHome = await getHome(tokenFor('ch-member'));
      expect(
        memberHome.myCommunities.some((c) => c.id === hiddenSection.id),
      ).toBe(true);

      const outsiderHome = await getHome(tokenFor('ch-outsider'));
      expect(
        outsiderHome.myCommunities.some((c) => c.id === hiddenSection.id),
      ).toBe(false);
      expect(
        outsiderHome.pendingInvitations.items.some(
          (i) => i.community.id === hiddenSection.id,
        ),
      ).toBe(false);
      expect(
        outsiderHome.pendingJoinRequests.items.some(
          (i) => i.community.id === hiddenSection.id,
        ),
      ).toBe(false);
    });
  });
});
