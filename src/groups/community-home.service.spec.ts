/**
 * Unit tests for CommunityHomeService.
 *
 * Covers:
 *  - aggregating a user's active Organizations and every Child Group they
 *    hold a Role in (including several Roles for the same Group),
 *  - excluding ARCHIVED communities, a user with no communities at all,
 *  - filtering pending invitations to the current user,
 *  - filtering pending join requests to communities where the caller holds
 *    GROUP_JOIN_REQUEST_REVIEW (never assuming ADMIN/OWNER is automatically
 *    enough - resolved through the real GroupPermissionService),
 *  - excluding READ_ONLY communities from join-request review capability
 *    (approve/reject require ACTIVE - see GroupPermissionsGuard defaults),
 *  - summary counts and capability flags.
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityHomeService } from './community-home.service';
import { MembershipRequestResponseDto } from './dto/membership-request-response.dto';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipRequestStatus } from './enums/membership-request-status.enum';
import { MembershipRequestTarget } from './enums/membership-request-target.enum';
import { GroupPermissionService } from './permissions/group-permission.service';
import { MembershipRequestsService } from './membership-requests.service';
import { RoleAssignmentsService } from './role-assignments.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.email = 'test@example.com';
  user.displayName = 'Test User';
  return Object.assign(user, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Group';
  group.description = null;
  group.logoUrl = null;
  group.coverImageUrl = null;
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  group.isPublic = true;
  group.isHidden = false;
  return Object.assign(group, overrides);
}

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.status = GroupMembershipStatus.ACTIVE;
  membership.rootGroup = buildGroup();
  return Object.assign(membership, overrides);
}

function buildInvitation(
  overrides: Partial<MembershipRequestResponseDto> = {},
): MembershipRequestResponseDto {
  return {
    id: 'invitation-1',
    type: 'INVITATION' as never,
    targetType: MembershipRequestTarget.GROUP,
    targetGroupId: 'group-1',
    status: MembershipRequestStatus.PENDING,
    initiatedBy: { id: 'inviter-1', displayName: 'Inviter' },
    invitedUser: { id: 'user-1', displayName: 'Test User' },
    invitedEmail: null,
    processedAt: null,
    processedBy: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

interface MockRouting {
  groupFindResults?: Group[];
}

function buildMockEm(
  memberships: GroupMembership[],
  routing: MockRouting = {},
) {
  const find = jest.fn((entity: unknown) => {
    if (entity === GroupMembership) return Promise.resolve(memberships);
    if (entity === Group) {
      return Promise.resolve(routing.groupFindResults ?? []);
    }
    return Promise.resolve([]);
  });
  return { em: { find } as unknown as EntityManager, find };
}

function buildService(
  em: EntityManager,
  options: {
    participation?: {
      membershipId: string;
      groupId: string;
      roles: GroupRole[];
    }[];
    invitations?: MembershipRequestResponseDto[];
    joinRequests?: MembershipRequestResponseDto[];
  } = {},
) {
  const getGroupParticipationForMemberships = jest
    .fn()
    .mockResolvedValue(options.participation ?? []);
  const roleAssignmentsService = {
    getGroupParticipationForMemberships,
  } as unknown as RoleAssignmentsService;

  const listReceivedInvitations = jest
    .fn()
    .mockResolvedValue(options.invitations ?? []);
  const listJoinRequestsForGroups = jest
    .fn()
    .mockResolvedValue(options.joinRequests ?? []);
  const membershipRequestsService = {
    listReceivedInvitations,
    listJoinRequestsForGroups,
  } as unknown as MembershipRequestsService;

  const service = new CommunityHomeService(
    em,
    new GroupPermissionService(),
    roleAssignmentsService,
    membershipRequestsService,
  );

  return {
    service,
    roleAssignmentsService,
    membershipRequestsService,
    listReceivedInvitations,
    listJoinRequestsForGroups,
  };
}

describe('CommunityHomeService', () => {
  describe('getHome() - My Communities', () => {
    it('returns an empty dashboard for a user with no active memberships', async () => {
      const { em } = buildMockEm([]);
      const { service } = buildService(em);

      const result = await service.getHome(buildUser());

      expect(result.myCommunities).toEqual([]);
      expect(result.summary).toEqual({
        communitiesCount: 0,
        pendingInvitationsCount: 0,
        pendingJoinRequestsCount: 0,
        actionableItemsCount: 0,
      });
      expect(result.capabilities.canCreateOrganization).toBe(true);
      expect(result.capabilities.canCreateGroupInCommunityIds).toEqual([]);
    });

    it('includes the Organization even when the Membership holds zero Role Assignments there', async () => {
      const root = buildGroup({ id: 'root-1', name: 'Cordão de Ouro' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const { service } = buildService(em, { participation: [] });

      const result = await service.getHome(buildUser());

      expect(result.myCommunities).toHaveLength(1);
      expect(result.myCommunities[0]).toMatchObject({
        id: 'root-1',
        rootGroupId: 'root-1',
        isRootGroup: true,
        myRoles: [],
      });
    });

    it('includes a Child Group the Membership holds Roles in, alongside its Organization, with multiple Roles preserved as an array', async () => {
      const root = buildGroup({ id: 'root-1', name: 'Cordão de Ouro' });
      const child = buildGroup({
        id: 'child-1',
        name: 'Poznań',
        parentGroup: root,
      });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], {
        groupFindResults: [root, child],
      });
      const { service } = buildService(em, {
        participation: [
          {
            membershipId: 'm-1',
            groupId: 'child-1',
            roles: [GroupRole.MEMBER, GroupRole.INSTRUCTOR],
          },
        ],
      });

      const result = await service.getHome(buildUser());

      expect(result.myCommunities).toHaveLength(2);
      const childEntry = result.myCommunities.find((c) => c.id === 'child-1');
      expect(childEntry).toMatchObject({
        parentGroupId: 'root-1',
        rootGroupId: 'root-1',
        isRootGroup: false,
        myRoles: [GroupRole.MEMBER, GroupRole.INSTRUCTOR],
      });
    });

    it('excludes an ARCHIVED community even though the Membership/Role Assignment still exists', async () => {
      const root = buildGroup({
        id: 'root-1',
        name: 'Archived Org',
        status: GroupStatus.ARCHIVED,
      });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      // The Group query itself filters out ARCHIVED rows (status: {$ne: ARCHIVED}),
      // so the mock simply returns nothing for it.
      const { em } = buildMockEm([membership], { groupFindResults: [] });
      const { service } = buildService(em, { participation: [] });

      const result = await service.getHome(buildUser());

      expect(result.myCommunities).toEqual([]);
    });
  });

  describe('getHome() - capabilities', () => {
    it('grants canCreateGroupInCommunityIds only where the union of held Roles includes GROUP_EDIT (Admin/Owner)', async () => {
      const root = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const { service } = buildService(em, {
        participation: [
          { membershipId: 'm-1', groupId: 'root-1', roles: [GroupRole.ADMIN] },
        ],
      });

      const result = await service.getHome(buildUser());

      expect(result.capabilities.canCreateGroupInCommunityIds).toEqual([
        'root-1',
      ]);
      expect(result.capabilities.canManageAnyCommunity).toBe(true);
    });

    it('does not grant canCreateGroupInCommunityIds for a plain MEMBER', async () => {
      const root = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const { service } = buildService(em, {
        participation: [
          {
            membershipId: 'm-1',
            groupId: 'root-1',
            roles: [GroupRole.MEMBER],
          },
        ],
      });

      const result = await service.getHome(buildUser());

      expect(result.capabilities.canCreateGroupInCommunityIds).toEqual([]);
      expect(result.capabilities.canManageAnyCommunity).toBe(false);
    });

    it('excludes a READ_ONLY community from canReviewJoinRequestsInCommunityIds even for an OWNER (approve/reject require ACTIVE)', async () => {
      const root = buildGroup({ id: 'root-1', status: GroupStatus.READ_ONLY });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const { service } = buildService(em, {
        participation: [
          { membershipId: 'm-1', groupId: 'root-1', roles: [GroupRole.OWNER] },
        ],
      });

      const result = await service.getHome(buildUser());

      expect(result.capabilities.canReviewJoinRequestsInCommunityIds).toEqual(
        [],
      );
      // GROUP_EDIT is still allowed while READ_ONLY-parented child creation
      // is concerned - only ARCHIVED parents are rejected, see
      // GroupsService.loadUsableParentForCreation.
      expect(result.capabilities.canCreateGroupInCommunityIds).toEqual([
        'root-1',
      ]);
    });

    it('does not grant canReviewJoinRequestsInCommunityIds for an INSTRUCTOR (lacks GROUP_JOIN_REQUEST_REVIEW)', async () => {
      const root = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const { service } = buildService(em, {
        participation: [
          {
            membershipId: 'm-1',
            groupId: 'root-1',
            roles: [GroupRole.INSTRUCTOR],
          },
        ],
      });

      const result = await service.getHome(buildUser());

      expect(result.capabilities.canReviewJoinRequestsInCommunityIds).toEqual(
        [],
      );
    });
  });

  describe('getHome() - Pending Invitations', () => {
    it("lists the caller's own pending invitations with a community reference, even for a community they do not belong to yet", async () => {
      const targetGroup = buildGroup({ id: 'target-1', name: 'New Group' });
      const { em } = buildMockEm([], { groupFindResults: [targetGroup] });
      const invitation = buildInvitation({ targetGroupId: 'target-1' });
      const { service } = buildService(em, { invitations: [invitation] });

      const result = await service.getHome(buildUser());

      expect(result.pendingInvitations.total).toBe(1);
      expect(result.pendingInvitations.items).toHaveLength(1);
      expect(result.pendingInvitations.items[0].community).toMatchObject({
        id: 'target-1',
        name: 'New Group',
      });
      expect(result.pendingInvitations.hasMore).toBe(false);
      expect(result.summary.pendingInvitationsCount).toBe(1);
    });

    it('does not issue a second Group query when the invitation targets a community already in My Communities', async () => {
      const root = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em, find } = buildMockEm([membership], {
        groupFindResults: [root],
      });
      const invitation = buildInvitation({ targetGroupId: 'root-1' });
      const { service } = buildService(em, {
        participation: [],
        invitations: [invitation],
      });

      await service.getHome(buildUser());

      // One find(GroupMembership) + one find(Group) for My Communities - no
      // extra find(Group) for the invitation, since root-1 is already known.
      const groupFindCalls = find.mock.calls.filter(
        ([entity]) => entity === Group,
      );
      expect(groupFindCalls).toHaveLength(1);
    });
  });

  describe('getHome() - Pending Join Requests', () => {
    it('only queries join requests for communities the caller can review, using GroupPermissionService rather than a role name check', async () => {
      const root = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const joinRequest = buildInvitation({
        id: 'jr-1',
        targetGroupId: 'root-1',
      });
      const { service, listJoinRequestsForGroups } = buildService(em, {
        participation: [
          { membershipId: 'm-1', groupId: 'root-1', roles: [GroupRole.ADMIN] },
        ],
        joinRequests: [joinRequest],
      });

      const result = await service.getHome(buildUser());

      expect(listJoinRequestsForGroups).toHaveBeenCalledWith(['root-1']);
      expect(result.pendingJoinRequests.total).toBe(1);
      expect(result.summary.pendingJoinRequestsCount).toBe(1);
    });

    it('never calls listJoinRequestsForGroups when the caller cannot review any community', async () => {
      const root = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ id: 'm-1', rootGroup: root });
      const { em } = buildMockEm([membership], { groupFindResults: [root] });
      const { service, listJoinRequestsForGroups } = buildService(em, {
        participation: [
          {
            membershipId: 'm-1',
            groupId: 'root-1',
            roles: [GroupRole.MEMBER],
          },
        ],
      });

      const result = await service.getHome(buildUser());

      expect(listJoinRequestsForGroups).not.toHaveBeenCalled();
      expect(result.pendingJoinRequests).toEqual({
        items: [],
        total: 0,
        hasMore: false,
      });
    });
  });
});
