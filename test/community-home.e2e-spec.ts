/**
 * E2E tests for GET /community/home (Community Home dashboard - PAD-001 §10).
 *
 * Scenarios:
 *  1. Unauthenticated request → 401
 *  2. Brand new user → empty dashboard with correct default capabilities
 *  3. User belonging to several Groups → every active Membership's
 *     Root Group appears in myCommunities
 *  4. A Membership holding several Roles for the same Group → myRoles is
 *     an array containing all of them (never collapsed to one `role`)
 *  5. The caller sees their own pending invitations
 *  6. The caller never sees another user's pending invitations
 *  7. A caller with GROUP_JOIN_REQUEST_REVIEW sees pending join requests
 *     for that community
 *  8. A plain MEMBER of the same community does not see its join requests
 *     (role name is not assumed sufficient - resolved via GroupPermissionService)
 *  9. A hidden (isHidden=true) community is fully visible to its own
 *     member, but leaks nothing to an unrelated outsider
 * 10. summary counters are consistent with the returned lists
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
import { CommunityHomeResponseDto } from '../src/groups/dto/community-home-response.dto';
import { GroupMembershipResponseDto } from '../src/groups/dto/group-membership-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { Group } from '../src/groups/entities/group.entity';
import { GroupMembership } from '../src/groups/entities/group-membership.entity';
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
    const cleanup = app.get(EntityManager).fork();
    await cleanup.nativeDelete(MembershipRequest, {
      targetGroup: { $in: createdGroupIds },
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

  async function addMember(
    ownerToken: string,
    rootGroupId: string,
    memberToken: string,
    role: GroupRole,
  ): Promise<GroupMembershipResponseDto> {
    return bodyOf<GroupMembershipResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${rootGroupId}/members`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({ userId: localUserIdByToken.get(memberToken), role })
        .expect(201),
    );
  }

  async function createSection(
    ownerToken: string,
    parentGroupId: string,
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto> {
    const created = await bodyOf<GroupResponseDto>(
      request(app.getHttpServer())
        .post(`/api/v1/groups/${parentGroupId}/sections`)
        .set('Authorization', `Bearer ${ownerToken}`)
        .send({
          name: 'Community Home Test Section',
          timezone: 'Europe/Warsaw',
          currencyCode: 'PLN',
          country: 'PL',
          ...overrides,
        })
        .expect(201),
    );
    createdGroupIds.push(created.id);
    return created;
  }

  async function grantRole(
    granterToken: string,
    groupId: string,
    membershipId: string,
    role: GroupRole,
  ): Promise<void> {
    await request(app.getHttpServer())
      .post(`/api/v1/groups/${groupId}/role-assignments`)
      .set('Authorization', `Bearer ${granterToken}`)
      .send({ membershipId, role })
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
      canCreateSectionInCommunityIds: [],
      canCreateEventInCommunityIds: [],
      canReviewJoinRequestsInCommunityIds: [],
      canViewMembersInCommunityIds: [],
      canManageMembersInCommunityIds: [],
      canInviteMembersInCommunityIds: [],
      canManageInvitationsInCommunityIds: [],
      canManageRolesInCommunityIds: [],
      canTransferOwnershipInCommunityIds: [],
      canArchiveCommunityIds: [],
      canRestoreCommunityIds: [],
      canDeleteCommunityIds: [],
      canViewAuditLogInCommunityIds: [],
      canManageNotificationsInCommunityIds: [],
      canBanMembersInCommunityIds: [],
      canSuspendMembersInCommunityIds: [],
      canManageAnyCommunity: false,
    });
  });

  describe('My Communities', () => {
    it('lists every active Membership across several Groups, and preserves multiple Roles for the same Group as an array', async () => {
      const orgOne = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Cordão de Ouro',
      });
      const orgTwo = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Abadá',
      });
      await addMember(
        tokenFor('ch-owner'),
        orgOne.id,
        tokenFor('ch-member'),
        GroupRole.MEMBER,
      );
      const membership = await addMember(
        tokenFor('ch-owner'),
        orgTwo.id,
        tokenFor('ch-member'),
        GroupRole.MEMBER,
      );
      await grantRole(
        tokenFor('ch-owner'),
        orgTwo.id,
        membership.id,
        GroupRole.INSTRUCTOR,
      );

      const home = await getHome(tokenFor('ch-member'));

      expect(home.myCommunities).toHaveLength(2);
      const orgOneEntry = home.myCommunities.find((c) => c.id === orgOne.id);
      const orgTwoEntry = home.myCommunities.find((c) => c.id === orgTwo.id);
      expect(orgOneEntry).toMatchObject({
        isRootGroup: true,
        myRoles: ['MEMBER'],
      });
      expect(orgTwoEntry?.isRootGroup).toBe(true);
      expect([...(orgTwoEntry?.myRoles ?? [])].sort()).toEqual(
        ['INSTRUCTOR', 'MEMBER'].sort(),
      );
      expect(home.summary.communitiesCount).toBe(2);
    });

    // Regression coverage for the "Moje społeczności" business rule:
    // joining a Section must never be treated as joining its parent Group
    // (ADR-004 "no membership inheritance"). GroupMembership.rootGroup is
    // always the Group (mandatory - see group-membership.entity.ts), so
    // this Section-only joiner's Membership still points there; the Group
    // legitimately still appears (it owns the tree this Section lives in -
    // see PAD-001 §11 "grouped by organization"), but only with an empty
    // myRoles - proving no Role/participation was ever granted for it.
    it('joining only a Section never grants a derived Role in its parent Group - the Group appears with an empty myRoles, the Section with the real one', async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Cordão de Ouro (Section test)',
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

      expect(home.myCommunities).toHaveLength(2);
      const orgEntry = home.myCommunities.find((c) => c.id === org.id);
      const sectionEntry = home.myCommunities.find((c) => c.id === section.id);
      expect(orgEntry).toMatchObject({ isRootGroup: true, myRoles: [] });
      expect(sectionEntry).toMatchObject({
        isRootGroup: false,
        parentId: org.id,
        myRoles: ['MEMBER'],
      });
    });
  });

  describe('Pending Invitations', () => {
    it("shows the caller's own pending invitation and never another user's", async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Invitation Test Org',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/invitations`)
        .set('Authorization', `Bearer ${tokenFor('ch-owner')}`)
        .send({
          targetType: 'GROUP',
          invitedUserId: localUserIdByToken.get(tokenFor('ch-invitee')),
        })
        .expect(201);

      const inviteeHome = await getHome(tokenFor('ch-invitee'));
      expect(inviteeHome.pendingInvitations.total).toBe(1);
      expect(inviteeHome.pendingInvitations.items[0].community).toMatchObject({
        id: org.id,
        name: 'Invitation Test Org',
        isRootGroup: true,
      });
      expect(inviteeHome.summary.pendingInvitationsCount).toBe(1);
      expect(inviteeHome.summary.actionableItemsCount).toBe(
        inviteeHome.summary.pendingInvitationsCount +
          inviteeHome.summary.pendingJoinRequestsCount,
      );

      const outsiderHome = await getHome(tokenFor('ch-outsider'));
      expect(
        outsiderHome.pendingInvitations.items.some(
          (invitation) => invitation.community.id === org.id,
        ),
      ).toBe(false);
    });
  });

  describe('Pending Join Requests', () => {
    it('are visible to a caller with GROUP_JOIN_REQUEST_REVIEW, and hidden from a plain MEMBER of the very same community', async () => {
      const org = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Join Request Test Org',
        isPublic: false,
      });
      await addMember(
        tokenFor('ch-owner'),
        org.id,
        tokenFor('ch-member'),
        GroupRole.MEMBER,
      );
      const adminMembership = await addMember(
        tokenFor('ch-owner'),
        org.id,
        tokenFor('ch-admin'),
        GroupRole.ADMIN,
      );
      void adminMembership;

      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/join`)
        .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
        .send({ targetType: 'GROUP' })
        .expect(200);

      const ownerHome = await getHome(tokenFor('ch-owner'));
      expect(
        ownerHome.capabilities.canReviewJoinRequestsInCommunityIds,
      ).toContain(org.id);
      const ownerJoinRequest = ownerHome.pendingJoinRequests.items.find(
        (item) => item.community.id === org.id,
      );
      expect(ownerJoinRequest).toBeDefined();

      const adminHome = await getHome(tokenFor('ch-admin'));
      expect(
        adminHome.capabilities.canReviewJoinRequestsInCommunityIds,
      ).toContain(org.id);
      expect(
        adminHome.pendingJoinRequests.items.some(
          (item) => item.community.id === org.id,
        ),
      ).toBe(true);

      const memberHome = await getHome(tokenFor('ch-member'));
      expect(
        memberHome.capabilities.canReviewJoinRequestsInCommunityIds,
      ).not.toContain(org.id);
      expect(
        memberHome.pendingJoinRequests.items.some(
          (item) => item.community.id === org.id,
        ),
      ).toBe(false);
    });
  });

  describe('Hidden communities', () => {
    it('are fully visible to their own member but leak nothing to an unrelated outsider', async () => {
      const hiddenOrg = await createRootGroup(tokenFor('ch-owner'), {
        name: 'Hidden Org',
        isHidden: true,
      });
      await addMember(
        tokenFor('ch-owner'),
        hiddenOrg.id,
        tokenFor('ch-member'),
        GroupRole.MEMBER,
      );

      const memberHome = await getHome(tokenFor('ch-member'));
      expect(memberHome.myCommunities.some((c) => c.id === hiddenOrg.id)).toBe(
        true,
      );

      const outsiderHome = await getHome(tokenFor('ch-outsider'));
      expect(
        outsiderHome.myCommunities.some((c) => c.id === hiddenOrg.id),
      ).toBe(false);
      expect(
        outsiderHome.pendingInvitations.items.some(
          (i) => i.community.id === hiddenOrg.id,
        ),
      ).toBe(false);
      expect(
        outsiderHome.pendingJoinRequests.items.some(
          (i) => i.community.id === hiddenOrg.id,
        ),
      ).toBe(false);
    });
  });
});
