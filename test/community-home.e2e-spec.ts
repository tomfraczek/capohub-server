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
import { createFreshGroupOwner } from './fresh-group-owner.helper';
import { CommunityHomeResponseDto } from '../src/groups/dto/community-home-response.dto';
import { GroupResponseDto } from '../src/groups/dto/group-response.dto';
import { SectionResponseDto } from '../src/groups/dto/section-response.dto';
import { AuditLogEntry } from '../src/groups/entities/audit-log-entry.entity';
import { FormalGroupAffiliation } from '../src/groups/entities/formal-group-affiliation.entity';
import { Group } from '../src/groups/entities/group.entity';
import { GroupFollow } from '../src/groups/entities/group-follow.entity';
import { Section } from '../src/groups/entities/section.entity';
import { SectionMembership } from '../src/groups/entities/section-membership.entity';
import { MembershipRequest } from '../src/groups/entities/membership-request.entity';
import { RoleAssignment } from '../src/groups/entities/role-assignment.entity';
import { GroupRole } from '../src/groups/enums/group-role.enum';
import { PaginatedResponse } from '../src/common/pagination/pagination.types';
import {
  CommunityGroupCardDto,
  CommunitySectionCardDto,
  NearbyGroupCardDto,
  NearbySectionCardDto,
} from '../src/groups/dto/community-overview-response.dto';
import { SavedLocationResponseDto } from '../src/users/dto/saved-location-response.dto';
import { User } from '../src/users/entities/user.entity';

const TOKENS = [
  'ch-owner',
  'ch-member',
  'ch-admin',
  'ch-outsider',
  'ch-invitee',
  'ch-newuser',
  'ch-section-member',
  'ch-follower',
  'ch-nearby-user',
  'ch-both-relation',
  'ch-multi-section',
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
      // GroupFollow.group has no delete cascade (see group-follow.entity.ts) -
      // must be cleared before the Group rows themselves, same reasoning as
      // Section-before-Group below. GroupFollow.user cascades on User
      // deletion, so no separate cleanup is needed for that side.
      await cleanup.nativeDelete(GroupFollow, {
        group: { $in: createdGroupIds },
      });
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
      // FormalGroupAffiliation.group has deleteRule 'no action' - must be
      // cleared before the Groups themselves are deleted below (see
      // user-profile.e2e-spec.ts's identical cleanup step).
      await cleanup.nativeDelete(FormalGroupAffiliation, {
        group: { $in: createdGroupIds },
      });
      await cleanup.nativeDelete(Group, { id: { $in: createdGroupIds } });
      // FIXTURE_CLERK_PROFILES, not the old frozen TEST_CLERK_USER_IDS
      // snapshot - createRootGroup (via createFreshGroupOwner) registers a
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
      ...overrides,
    };
  }

  // Every caller in this file passed tokenFor('ch-owner') here - the same,
  // single fixed identity reused across the whole file. GroupsService.create
  // now allows at most one active FormalGroupAffiliation per user (see
  // USER_ALREADY_HAS_FORMAL_GROUP), so a fixed 'ch-owner' would 409 on every
  // call after the first. None of these tests actually care who owns the
  // org - only that it has a working OWNER able to create Sections/grant
  // roles within that one test - so this now mints a fresh, throwaway owner
  // per call instead, and returns it (merged onto the GroupResponseDto
  // fields, so `org.id`/`.name`/... keep working exactly as before) for the
  // caller to act as for the rest of that test, via `.token`/`.userId`.
  async function createRootGroup(
    overrides: Record<string, unknown> = {},
  ): Promise<GroupResponseDto & { token: string; userId: string }> {
    const owner = await createFreshGroupOwner({
      app,
      tokenToAuth: TOKEN_TO_AUTH,
      clerkProfiles: FIXTURE_CLERK_PROFILES,
      onGroupCreated: (id) => createdGroupIds.push(id),
      namePrefix: 'ch-owner',
      groupOverrides: groupPayload(overrides),
    });
    return { ...owner.group, token: owner.token, userId: owner.userId };
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

  // `location` mirrors the caller's currently-active location (device GPS or
  // a SavedLocation) as GET /community/home's own query params now expect -
  // the server no longer holds a stored location to fall back on (see
  // CommunityOverviewService's own class comment). Omitted entirely (rather
  // than defaulted) when the caller has none active.
  async function getHome(
    token: string,
    location?: {
      latitude: number;
      longitude: number;
      countryCode?: string;
      city?: string;
      region?: string;
    },
  ): Promise<CommunityHomeResponseDto> {
    const query = location
      ? '?' +
        new URLSearchParams(
          Object.entries(location).map(([key, value]) => [key, String(value)]),
        ).toString()
      : '';
    return bodyOf<CommunityHomeResponseDto>(
      request(app.getHttpServer())
        .get(`/api/v1/community/home${query}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200),
    );
  }

  async function createSavedLocation(
    token: string,
    overrides: Record<string, unknown> = {},
  ): Promise<SavedLocationResponseDto> {
    return bodyOf<SavedLocationResponseDto>(
      request(app.getHttpServer())
        .post('/api/v1/users/me/locations')
        .set('Authorization', `Bearer ${token}`)
        .send({
          name: null,
          city: 'Poznań',
          region: null,
          countryCode: 'PL',
          latitude: 52.4064,
          longitude: 16.9252,
          ...overrides,
        })
        .expect(201),
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
      canCreateTrainingInSectionIds: [],
      canCreateTrainingSeriesInSectionIds: [],
      canManageTrainingSeriesInSectionIds: [],
      canViewTrainingStatsInSectionIds: [],
      canManageGraduationSystemInGroupIds: [],
      canViewFollowersInGroupIds: [],
      canManageFollowersInGroupIds: [],
      canManageAnyCommunity: false,
    });
  });

  describe('My Communities', () => {
    it('lists every Group the user holds ADMIN on (Group has no MEMBER role - it is administered only via OWNER/ADMIN)', async () => {
      const orgOne = await createRootGroup({
        name: 'Cordão de Ouro',
      });
      const orgTwo = await createRootGroup({
        name: 'Abadá',
      });
      await grantGroupRole(
        orgOne.token,
        orgOne.id,
        tokenFor('ch-member'),
        GroupRole.ADMIN,
      );
      await grantGroupRole(
        orgTwo.token,
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
      const org = await createRootGroup({
        name: 'Cordão de Ouro (multi-role Section test)',
      });
      const section = await createSection(org.token, org.id, {
        name: 'Multi-role Section',
      });
      await addSectionMember(org.token, section.id, tokenFor('ch-member'));
      await grantSectionRole(
        org.token,
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
      const org = await createRootGroup({
        name: 'Cordão de Ouro (Section-only test)',
      });
      const section = await createSection(org.token, org.id, {
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
      const org = await createRootGroup({
        name: 'Invitation Test Org',
      });
      const section = await createSection(org.token, org.id, {
        name: 'Invitation Test Section',
      });

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/invitations`)
        .set('Authorization', `Bearer ${org.token}`)
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
      const org = await createRootGroup({
        name: 'Join Request Test Org',
      });
      // The Section creator (org's fresh owner) automatically becomes its
      // OWNER - no separate grant needed for the review-capability
      // assertion below.
      const section = await createSection(org.token, org.id, {
        name: 'Join Request Test Section',
        isPublic: false,
      });
      await addSectionMember(org.token, section.id, tokenFor('ch-member'));
      await addSectionMember(
        org.token,
        section.id,
        tokenFor('ch-admin'),
        GroupRole.ADMIN,
      );

      await request(app.getHttpServer())
        .post(`/api/v1/sections/${section.id}/join`)
        .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
        .send({ targetType: 'SECTION' })
        .expect(200);

      const ownerHome = await getHome(org.token);
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
      const org = await createRootGroup({
        name: 'Hidden Org',
      });
      const hiddenSection = await createSection(org.token, org.id, {
        name: 'Hidden Section',
        isHidden: true,
      });
      await addSectionMember(
        org.token,
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

  describe('mySections / myGroups', () => {
    it('a user belonging to several Sections of the same Group: myGroups lists that Group exactly once', async () => {
      const org = await createRootGroup({
        name: 'Overview Org',
      });
      const sectionA = await createSection(org.token, org.id, {
        name: 'Overview Section A',
      });
      const sectionB = await createSection(org.token, org.id, {
        name: 'Overview Section B',
      });
      await addSectionMember(
        org.token,
        sectionA.id,
        tokenFor('ch-multi-section'),
      );
      await addSectionMember(
        org.token,
        sectionB.id,
        tokenFor('ch-multi-section'),
      );

      const home = await getHome(tokenFor('ch-multi-section'));

      expect(home.mySections.items.map((s) => s.id).sort()).toEqual(
        [sectionA.id, sectionB.id].sort(),
      );
      expect(home.myGroups.items.filter((g) => g.id === org.id)).toHaveLength(
        1,
      );
      const groupCard = home.myGroups.items.find((g) => g.id === org.id);
      expect(groupCard).toMatchObject({
        isMemberThroughSection: true,
        isFollowing: false,
      });
    });

    it('a Group related through both Section membership AND an explicit follow appears exactly once, with both flags true', async () => {
      const org = await createRootGroup({
        name: 'Both Relation Org',
      });
      const section = await createSection(org.token, org.id, {
        name: 'Both Relation Section',
      });
      await addSectionMember(
        org.token,
        section.id,
        tokenFor('ch-both-relation'),
      );
      await request(app.getHttpServer())
        .post(`/api/v1/groups/${org.id}/follow`)
        .set('Authorization', `Bearer ${tokenFor('ch-both-relation')}`)
        .expect(201);

      const home = await getHome(tokenFor('ch-both-relation'));

      expect(home.myGroups.items.filter((g) => g.id === org.id)).toHaveLength(
        1,
      );
      expect(home.myGroups.items.find((g) => g.id === org.id)).toMatchObject({
        isMemberThroughSection: true,
        isFollowing: true,
      });
    });
  });

  describe('Group follow/unfollow', () => {
    it('follow/unfollow are idempotent and toggle isFollowing on GroupResponseDto without granting any membership', async () => {
      const org = await createRootGroup({
        name: 'Follow Test Org',
      });

      const follow1 = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/follow`)
          .set('Authorization', `Bearer ${tokenFor('ch-follower')}`)
          .expect(201),
      );
      expect(follow1.isFollowing).toBe(true);
      expect(follow1.isMemberThroughSection).toBe(false);

      // Idempotent - following again is still a success, still isFollowing.
      const follow2 = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .post(`/api/v1/groups/${org.id}/follow`)
          .set('Authorization', `Bearer ${tokenFor('ch-follower')}`)
          .expect(201),
      );
      expect(follow2.isFollowing).toBe(true);

      const homeWhileFollowing = await getHome(tokenFor('ch-follower'));
      expect(
        homeWhileFollowing.myGroups.items.some((g) => g.id === org.id),
      ).toBe(true);

      const unfollow1 = await bodyOf<GroupResponseDto>(
        request(app.getHttpServer())
          .delete(`/api/v1/groups/${org.id}/follow`)
          .set('Authorization', `Bearer ${tokenFor('ch-follower')}`)
          .expect(200),
      );
      expect(unfollow1.isFollowing).toBe(false);

      // Idempotent - unfollowing an already-not-followed Group is still 200.
      await request(app.getHttpServer())
        .delete(`/api/v1/groups/${org.id}/follow`)
        .set('Authorization', `Bearer ${tokenFor('ch-follower')}`)
        .expect(200);

      const homeAfterUnfollow = await getHome(tokenFor('ch-follower'));
      expect(
        homeAfterUnfollow.myGroups.items.some((g) => g.id === org.id),
      ).toBe(false);
    });
  });

  describe('Nearby discovery', () => {
    it('no location context sent: location.configured is false and nearbySections/nearbyGroups are empty, mySections/myGroups still work', async () => {
      const home = await getHome(tokenFor('ch-newuser'));

      expect(home.location).toEqual({ configured: false });
      expect(home.nearbySections).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });
      expect(home.nearbyGroups).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });
    });

    it('nearbySections excludes the caller own Section, and nearbyGroups excludes myGroups, both ranked distance ASC', async () => {
      const location = await createSavedLocation(tokenFor('ch-nearby-user'), {
        latitude: 52.4064,
        longitude: 16.9252,
      });

      // The caller's own Group/Section - close to their own location (the
      // helper's own default city, Poznań), but must never appear in
      // nearbySections/nearbyGroups (it's already "mine").
      const myOrg = await createRootGroup({
        name: 'Nearby Mine Org',
      });
      const mySection = await createSection(myOrg.token, myOrg.id, {
        name: 'Nearby Mine Section',
      });
      await addSectionMember(
        myOrg.token,
        mySection.id,
        tokenFor('ch-nearby-user'),
      );

      // A closer, unrelated Section (~7km away - Luboń, a real Poznań
      // suburb) - SectionsService derives coordinates from geonameId (see
      // sections.service.ts#applyFields), so a real, distinct city is what
      // actually produces a real, distinct distance here, not a raw
      // latitude/longitude override (no longer trusted from the request
      // body at all).
      const nearOrg = await createRootGroup({
        name: 'Nearby Near Org',
      });
      const nearSection = await createSection(nearOrg.token, nearOrg.id, {
        name: 'Nearby Near Section',
        city: 'Luboń',
        region: 'Greater Poland',
        geonameId: 3092856,
      });

      // A farther, unrelated Section of a different Group (~20km away -
      // Murowana Goślina) - still within the default 50km radius.
      const farOrg = await createRootGroup({
        name: 'Nearby Far Org',
      });
      const farSection = await createSection(farOrg.token, farOrg.id, {
        name: 'Nearby Far Section',
        city: 'Murowana Goślina',
        region: 'Greater Poland',
        geonameId: 3091293,
      });

      const home = await getHome(tokenFor('ch-nearby-user'), {
        latitude: location.latitude,
        longitude: location.longitude,
        countryCode: location.countryCode ?? undefined,
        city: location.city ?? undefined,
      });

      expect(home.location).toMatchObject({
        configured: true,
        city: 'Poznań',
        countryCode: 'PL',
      });

      const nearbySectionIds = home.nearbySections.items.map((s) => s.id);
      expect(nearbySectionIds).not.toContain(mySection.id);
      expect(nearbySectionIds).toContain(nearSection.id);
      expect(nearbySectionIds).toContain(farSection.id);
      // distance ASC.
      expect(nearbySectionIds.indexOf(nearSection.id)).toBeLessThan(
        nearbySectionIds.indexOf(farSection.id),
      );

      const nearbyGroupIds = home.nearbyGroups.items.map((g) => g.id);
      expect(nearbyGroupIds).not.toContain(myOrg.id);
      expect(nearbyGroupIds).toContain(nearOrg.id);
      expect(nearbyGroupIds).toContain(farOrg.id);
      expect(nearbyGroupIds.indexOf(nearOrg.id)).toBeLessThan(
        nearbyGroupIds.indexOf(farOrg.id),
      );
      const nearGroupCard = home.nearbyGroups.items.find(
        (g) => g.id === nearOrg.id,
      );
      expect(nearGroupCard?.nearestSection.id).toBe(nearSection.id);
    });
  });

  describe('Paginated "See all" endpoints', () => {
    it('GET /community/{sections,groups}/mine mirror the same mySections/myGroups data Home returns, fully paginated', async () => {
      const org = await createRootGroup({
        name: 'See All Org',
      });
      const section = await createSection(org.token, org.id, {
        name: 'See All Section',
      });
      await addSectionMember(
        org.token,
        section.id,
        tokenFor('ch-admin'),
        GroupRole.ADMIN,
      );

      const sectionsPage = await bodyOf<
        PaginatedResponse<CommunitySectionCardDto>
      >(
        request(app.getHttpServer())
          .get('/api/v1/community/sections/mine')
          .set('Authorization', `Bearer ${tokenFor('ch-admin')}`)
          .expect(200),
      );
      expect(sectionsPage.data.some((s) => s.id === section.id)).toBe(true);
      expect(sectionsPage.meta).toMatchObject({ page: 1 });

      const groupsPage = await bodyOf<PaginatedResponse<CommunityGroupCardDto>>(
        request(app.getHttpServer())
          .get('/api/v1/community/groups/mine')
          .set('Authorization', `Bearer ${tokenFor('ch-admin')}`)
          .expect(200),
      );
      expect(groupsPage.data.some((g) => g.id === org.id)).toBe(true);
    });

    it('GET /community/{sections,groups}/nearby accept a radiusKm override and mirror nearbySections/nearbyGroups', async () => {
      // SectionsService always derives a Section's coordinates from its own
      // geonameId (see sections.service.ts#applyFields) rather than trusting
      // a client-supplied latitude/longitude - createSection's own default
      // geonameId (3088171, Poznań) is what actually determines where this
      // fixture Section ends up, so the request's own location query params
      // (below) must point at that same real place (not an arbitrary (0,0)
      // the Section could never actually be derived to).
      const org = await createRootGroup({
        name: 'See All Nearby Org',
      });
      const section = await createSection(org.token, org.id, {
        name: 'See All Nearby Section',
      });

      const locationQuery = '&latitude=52.4064&longitude=16.9252';
      const sectionsPage = await bodyOf<
        PaginatedResponse<NearbySectionCardDto>
      >(
        request(app.getHttpServer())
          .get(`/api/v1/community/sections/nearby?radiusKm=10${locationQuery}`)
          .set('Authorization', `Bearer ${tokenFor('ch-follower')}`)
          .expect(200),
      );
      expect(sectionsPage.data.some((s) => s.id === section.id)).toBe(true);

      const groupsPage = await bodyOf<PaginatedResponse<NearbyGroupCardDto>>(
        request(app.getHttpServer())
          .get(`/api/v1/community/groups/nearby?radiusKm=10${locationQuery}`)
          .set('Authorization', `Bearer ${tokenFor('ch-follower')}`)
          .expect(200),
      );
      expect(groupsPage.data.some((g) => g.id === org.id)).toBe(true);
    });
  });

  describe('Saved locations (GET/POST/PATCH/DELETE /users/me/locations)', () => {
    it('is empty until one is created, and lists every created location', async () => {
      const beforeList = await bodyOf<SavedLocationResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/locations')
          .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
          .expect(200),
      );
      expect(beforeList).toEqual([]);

      const poznan = await createSavedLocation(tokenFor('ch-newuser'), {
        city: 'Poznań',
        countryCode: 'PL',
        latitude: 52.4064,
        longitude: 16.9252,
      });
      expect(poznan).toMatchObject({
        name: null,
        city: 'Poznań',
        countryCode: 'PL',
        latitude: 52.4064,
        longitude: 16.9252,
        notificationsEnabled: false,
      });
      // A SavedLocation only answers "where" - the search radius is a
      // per-request filter, never stored on it.
      expect(poznan).not.toHaveProperty('radiusKm');

      const wroclaw = await createSavedLocation(tokenFor('ch-newuser'), {
        name: 'Praca',
        city: 'Wrocław',
        countryCode: 'PL',
        latitude: 51.1079,
        longitude: 17.0385,
      });
      expect(wroclaw).toMatchObject({ name: 'Praca' });

      const afterList = await bodyOf<SavedLocationResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/locations')
          .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
          .expect(200),
      );
      expect(afterList.map((l) => l.id).sort()).toEqual(
        [poznan.id, wroclaw.id].sort(),
      );
    });

    it('never lists another caller own locations - each user only ever sees their own', async () => {
      await createSavedLocation(tokenFor('ch-owner'));

      const list = await bodyOf<SavedLocationResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/locations')
          .set('Authorization', `Bearer ${tokenFor('ch-member')}`)
          .expect(200),
      );
      expect(list).toEqual([]);
    });

    it('PATCH renaming a location never changes its latitude/longitude', async () => {
      const location = await createSavedLocation(tokenFor('ch-newuser'));

      const renamed = await bodyOf<SavedLocationResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/locations/${location.id}`)
          .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
          .send({ name: 'Dom' })
          .expect(200),
      );
      expect(renamed.name).toBe('Dom');
      expect(renamed.latitude).toBe(location.latitude);
      expect(renamed.longitude).toBe(location.longitude);
      expect(renamed.city).toBe(location.city);
    });

    it('ignores a radiusKm sent by an older client - on create and on PATCH - never storing or echoing it', async () => {
      const location = await createSavedLocation(tokenFor('ch-newuser'), {
        name: 'Dom',
        radiusKm: 25,
      });
      expect(location).not.toHaveProperty('radiusKm');

      const updated = await bodyOf<SavedLocationResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/locations/${location.id}`)
          .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
          .send({ radiusKm: 100 })
          .expect(200),
      );
      expect(updated).not.toHaveProperty('radiusKm');
      expect(updated.name).toBe('Dom');
    });

    it('PATCH silently ignores an attempt to change latitude/longitude - only name is accepted', async () => {
      const location = await createSavedLocation(tokenFor('ch-newuser'));

      const updated = await bodyOf<SavedLocationResponseDto>(
        request(app.getHttpServer())
          .patch(`/api/v1/users/me/locations/${location.id}`)
          .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
          .send({ latitude: 0, longitude: 0, name: 'Still Poznań' })
          .expect(200),
      );
      expect(updated.latitude).toBe(location.latitude);
      expect(updated.longitude).toBe(location.longitude);
    });

    it('DELETE removes the location - it no longer appears in the list', async () => {
      const location = await createSavedLocation(tokenFor('ch-newuser'));

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/locations/${location.id}`)
        .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
        .expect(204);

      const list = await bodyOf<SavedLocationResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/locations')
          .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
          .expect(200),
      );
      expect(list.find((l) => l.id === location.id)).toBeUndefined();
    });

    it('never lets a caller update or delete another caller own location (404, not 403 - IDOR-safe)', async () => {
      const location = await createSavedLocation(tokenFor('ch-owner'));

      await request(app.getHttpServer())
        .patch(`/api/v1/users/me/locations/${location.id}`)
        .set('Authorization', `Bearer ${tokenFor('ch-member')}`)
        .send({ name: 'Not mine' })
        .expect(404);

      await request(app.getHttpServer())
        .delete(`/api/v1/users/me/locations/${location.id}`)
        .set('Authorization', `Bearer ${tokenFor('ch-member')}`)
        .expect(404);

      // Still there - the ch-member attempts above must not have touched it.
      const list = await bodyOf<SavedLocationResponseDto[]>(
        request(app.getHttpServer())
          .get('/api/v1/users/me/locations')
          .set('Authorization', `Bearer ${tokenFor('ch-owner')}`)
          .expect(200),
      );
      expect(list.some((l) => l.id === location.id)).toBe(true);
    });

    it('rejects an out-of-range latitude/longitude', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/me/locations')
        .set('Authorization', `Bearer ${tokenFor('ch-newuser')}`)
        .send({
          city: 'Nowhere',
          countryCode: 'PL',
          latitude: 200,
          longitude: 16.9252,
        })
        .expect(400);
    });
  });
});
