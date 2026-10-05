/**
 * Unit tests for CommunityHomeService - the participation/capability
 * resolver behind GET /community/home. Covers (post
 * Membership/RoleAssignments/Permissions rebuild):
 *  - capabilities split into ...GroupIds/...SectionIds pairs, never mixed
 *  - a membership-lifecycle capability (canManageMembersInSectionIds) is
 *    never populated for a Group, even when the caller is OWNER there
 *  - canManageNotificationsInSectionIds is Section-only and ACTIVE-only
 *  - myCommunities excludes ARCHIVED, but canRestore*Ids still includes it
 *  - no inheritance: a Role held on a Group never adds any other community
 */

import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityHomeService } from './community-home.service';
import { CommunityOverviewService } from './community-overview.service';
import { FormalGroupAffiliation } from './entities/formal-group-affiliation.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { MembershipRequestsService } from './membership-requests.service';
import { R2StorageService } from '../storage/r2-storage.service';

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  return Object.assign(user, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
  group.name = 'Cordão de Ouro';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  group.isPublic = true;
  group.isHidden = false;
  group.memberInvitesAllowed = false;
  return Object.assign(group, overrides);
}

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Cordão de Ouro Poznan';
  section.status = GroupStatus.ACTIVE;
  section.isPublic = true;
  section.isHidden = false;
  section.memberInvitesAllowed = false;
  return Object.assign(section, overrides);
}

function buildMembership(
  overrides: Partial<SectionMembership> = {},
): SectionMembership {
  const membership = new SectionMembership();
  membership.id = 'membership-1';
  membership.status = SectionMembershipStatus.ACTIVE;
  return Object.assign(membership, overrides);
}

interface Setup {
  participation: { userId: string; groupId: string; roles: GroupRole[] }[];
  groups?: Group[];
  sections?: Section[];
  sectionMemberships?: SectionMembership[];
  hasActiveFormalGroup?: boolean;
  ownsGroup?: boolean;
}

function buildService(setup: Setup) {
  const em = {
    find: jest.fn((entity: unknown) => {
      if (entity === Group) return Promise.resolve(setup.groups ?? []);
      if (entity === Section) return Promise.resolve(setup.sections ?? []);
      if (entity === SectionMembership) {
        return Promise.resolve(setup.sectionMemberships ?? []);
      }
      // userOwnsGroup's live OWNER rows - opt-in, like hasActiveFormalGroup.
      if (entity === RoleAssignment) {
        return Promise.resolve(
          setup.ownsGroup ? [{ group: { id: 'owned-group' } }] : [],
        );
      }
      return Promise.resolve([]);
    }),
    // Backs canCreateGroup's hasActiveFormalGroup check - defaults to "no
    // active formal group" unless a test opts in.
    count: jest.fn((entity: unknown) => {
      if (entity === FormalGroupAffiliation) {
        return Promise.resolve(setup.hasActiveFormalGroup ? 1 : 0);
      }
      return Promise.resolve(0);
    }),
  } as unknown as EntityManager;

  const roleAssignmentsService = {
    getGroupParticipationForUsers: jest
      .fn()
      .mockResolvedValue(setup.participation),
  } as unknown as RoleAssignmentsService;

  const groupHierarchyService = {
    resolveRootGroup: jest.fn((community: Group | Section) =>
      Promise.resolve(community instanceof Group ? community : buildGroup()),
    ),
  } as unknown as GroupHierarchyService;

  const membershipRequestsService = {
    listReceivedInvitations: jest.fn().mockResolvedValue([]),
    listJoinRequestsForGroups: jest.fn().mockResolvedValue([]),
  } as unknown as MembershipRequestsService;

  const groupPermissionService = new GroupPermissionService();
  const r2StorageService = {
    buildPublicUrl: (key: string) => `https://cdn.example.com/${key}`,
  } as unknown as R2StorageService;

  // Community Home's five overview fields (location/mySections/myGroups/
  // nearbySections/nearbyGroups) are CommunityOverviewService's own concern
  // - covered by community-overview.service.spec.ts - so this file's mock
  // just returns empty/unconfigured, keeping every existing myCommunities/
  // capabilities test above unaffected.
  const communityOverviewService = {
    getLocationSummary: jest.fn().mockReturnValue({ configured: false }),
    getMySections: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, hasMore: false }),
    getMyGroups: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, hasMore: false }),
    getNearbySections: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, hasMore: false }),
    getNearbyGroups: jest
      .fn()
      .mockResolvedValue({ items: [], total: 0, hasMore: false }),
  } as unknown as CommunityOverviewService;

  const service = new CommunityHomeService(
    em,
    groupPermissionService,
    roleAssignmentsService,
    groupHierarchyService,
    membershipRequestsService,
    r2StorageService,
    communityOverviewService,
  );

  return { service, em };
}

describe('CommunityHomeService', () => {
  it('Group OWNER: capabilities land only in the ...GroupIds field, never ...SectionIds', async () => {
    const group = buildGroup({ id: 'group-1' });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'group-1', roles: [GroupRole.OWNER] },
      ],
      groups: [group],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canArchiveGroupIds).toEqual(['group-1']);
    expect(home.capabilities.canArchiveSectionIds).toEqual([]);
    expect(home.capabilities.canManageRolesInGroupIds).toEqual(['group-1']);
  });

  it('a membership-lifecycle capability (manage members) is never populated for a Group, even for its OWNER', async () => {
    const group = buildGroup({ id: 'group-1' });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'group-1', roles: [GroupRole.OWNER] },
      ],
      groups: [group],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canManageMembersInSectionIds).toEqual([]);
    // There is no canManageMembersInGroupIds field at all - Group has no
    // membership-lifecycle capability, structurally.
    expect(
      (home.capabilities as unknown as Record<string, unknown>)[
        'canManageMembersInGroupIds'
      ],
    ).toBeUndefined();
  });

  it('Section OWNER: membership-lifecycle capabilities land in ...SectionIds', async () => {
    const section = buildSection({ id: 'section-1' });
    const membership = buildMembership({ section, user: buildUser() });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'section-1', roles: [GroupRole.OWNER] },
      ],
      sections: [section],
      sectionMemberships: [membership],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canManageMembersInSectionIds).toEqual([
      'section-1',
    ]);
    expect(home.capabilities.canBanMembersInSectionIds).toEqual(['section-1']);
    expect(home.capabilities.canSuspendMembersInSectionIds).toEqual([
      'section-1',
    ]);
  });

  it('canManageNotificationsInSectionIds requires ACTIVE - a READ_ONLY (suspended) membership does not get it', async () => {
    const section = buildSection({ id: 'section-1' });
    const membership = buildMembership({
      section,
      user: buildUser(),
      status: SectionMembershipStatus.READ_ONLY,
    });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'section-1', roles: [GroupRole.MEMBER] },
      ],
      sections: [section],
      sectionMemberships: [membership],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canManageNotificationsInSectionIds).toEqual([]);
  });

  it('myCommunities excludes ARCHIVED communities, but canRestoreGroupIds still includes it for the OWNER', async () => {
    const archivedGroup = buildGroup({
      id: 'group-1',
      status: GroupStatus.ARCHIVED,
    });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'group-1', roles: [GroupRole.OWNER] },
      ],
      groups: [archivedGroup],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.myCommunities).toEqual([]);
    expect(home.capabilities.canRestoreGroupIds).toEqual(['group-1']);
  });

  it('no inheritance: a Role held only on a Group never adds any Section to any capability list', async () => {
    const group = buildGroup({ id: 'group-1' });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'group-1', roles: [GroupRole.OWNER] },
      ],
      groups: [group],
    });

    const home = await service.getHome(buildUser(), null);

    for (const [key, value] of Object.entries(home.capabilities)) {
      if (key.endsWith('SectionIds')) {
        expect(value).toEqual([]);
      }
    }
  });

  it('a plain MEMBER (Section) never receives any admin capability', async () => {
    const section = buildSection({ id: 'section-1' });
    const membership = buildMembership({ section, user: buildUser() });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'section-1', roles: [GroupRole.MEMBER] },
      ],
      sections: [section],
      sectionMemberships: [membership],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canManageMembersInSectionIds).toEqual([]);
    expect(home.capabilities.canArchiveSectionIds).toEqual([]);
    expect(home.capabilities.canTransferOwnershipInSectionIds).toEqual([]);
    // MEMBER does get view-tier capabilities.
    expect(home.capabilities.canViewMembersInSectionIds).toEqual(['section-1']);
  });

  it('canManageAnyCommunity is true iff canCreateSectionIn{Group,Section}Ids is non-empty', async () => {
    const group = buildGroup({ id: 'group-1' });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'group-1', roles: [GroupRole.ADMIN] },
      ],
      groups: [group],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canCreateSectionInGroupIds).toEqual(['group-1']);
    expect(home.capabilities.canManageAnyCommunity).toBe(true);
  });

  it('Section OWNER/ADMIN: full Training capability set, including Stats', async () => {
    for (const role of [GroupRole.OWNER, GroupRole.ADMIN]) {
      const section = buildSection({ id: 'section-1' });
      const membership = buildMembership({ section, user: buildUser() });
      const { service } = buildService({
        participation: [
          { userId: 'user-1', groupId: 'section-1', roles: [role] },
        ],
        sections: [section],
        sectionMemberships: [membership],
      });

      const home = await service.getHome(buildUser(), null);

      expect(home.capabilities.canCreateTrainingInSectionIds).toEqual([
        'section-1',
      ]);
      expect(home.capabilities.canCreateTrainingSeriesInSectionIds).toEqual([
        'section-1',
      ]);
      expect(home.capabilities.canManageTrainingSeriesInSectionIds).toEqual([
        'section-1',
      ]);
      expect(home.capabilities.canViewTrainingStatsInSectionIds).toEqual([
        'section-1',
      ]);
    }
  });

  it('Section INSTRUCTOR: can create/manage Trainings but NOT view Stats', async () => {
    const section = buildSection({ id: 'section-1' });
    const membership = buildMembership({ section, user: buildUser() });
    const { service } = buildService({
      participation: [
        {
          userId: 'user-1',
          groupId: 'section-1',
          roles: [GroupRole.INSTRUCTOR],
        },
      ],
      sections: [section],
      sectionMemberships: [membership],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canCreateTrainingInSectionIds).toEqual([
      'section-1',
    ]);
    expect(home.capabilities.canCreateTrainingSeriesInSectionIds).toEqual([
      'section-1',
    ]);
    expect(home.capabilities.canManageTrainingSeriesInSectionIds).toEqual([
      'section-1',
    ]);
    expect(home.capabilities.canViewTrainingStatsInSectionIds).toEqual([]);
  });

  it('a plain MEMBER (Section) gets no Training capability at all', async () => {
    const section = buildSection({ id: 'section-1' });
    const membership = buildMembership({ section, user: buildUser() });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'section-1', roles: [GroupRole.MEMBER] },
      ],
      sections: [section],
      sectionMemberships: [membership],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canCreateTrainingInSectionIds).toEqual([]);
    expect(home.capabilities.canCreateTrainingSeriesInSectionIds).toEqual([]);
    expect(home.capabilities.canManageTrainingSeriesInSectionIds).toEqual([]);
    expect(home.capabilities.canViewTrainingStatsInSectionIds).toEqual([]);
  });

  it('Training capabilities are never populated for a Group (Training is Section-only)', async () => {
    const group = buildGroup({ id: 'group-1' });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'group-1', roles: [GroupRole.OWNER] },
      ],
      groups: [group],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canCreateTrainingInSectionIds).toEqual([]);
    expect(home.capabilities.canCreateTrainingSeriesInSectionIds).toEqual([]);
    expect(home.capabilities.canManageTrainingSeriesInSectionIds).toEqual([]);
    expect(home.capabilities.canViewTrainingStatsInSectionIds).toEqual([]);
    expect(
      (home.capabilities as unknown as Record<string, unknown>)[
        'canCreateTrainingInGroupIds'
      ],
    ).toBeUndefined();
  });

  it('Group OWNER/ADMIN: canManageGraduationSystemInGroupIds lists the Group', async () => {
    for (const role of [GroupRole.OWNER, GroupRole.ADMIN]) {
      const group = buildGroup({ id: 'group-1' });
      const { service } = buildService({
        participation: [
          { userId: 'user-1', groupId: 'group-1', roles: [role] },
        ],
        groups: [group],
      });

      const home = await service.getHome(buildUser(), null);

      expect(home.capabilities.canManageGraduationSystemInGroupIds).toEqual([
        'group-1',
      ]);
      expect(home.capabilities.canViewFollowersInGroupIds).toEqual(['group-1']);
      expect(home.capabilities.canManageFollowersInGroupIds).toEqual([
        'group-1',
      ]);
    }
  });

  it('canManageGraduationSystemInGroupIds is never populated for a Section (graduation catalog is Group-only)', async () => {
    const section = buildSection({ id: 'section-1' });
    const membership = buildMembership({ section, user: buildUser() });
    const { service } = buildService({
      participation: [
        { userId: 'user-1', groupId: 'section-1', roles: [GroupRole.OWNER] },
      ],
      sections: [section],
      sectionMemberships: [membership],
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canManageGraduationSystemInGroupIds).toEqual([]);
    expect(home.capabilities.canViewFollowersInGroupIds).toEqual([]);
    expect(home.capabilities.canManageFollowersInGroupIds).toEqual([]);
  });

  it('returns an empty dashboard when the user participates in nothing', async () => {
    const { service } = buildService({ participation: [] });

    const home = await service.getHome(buildUser(), null);

    expect(home.myCommunities).toEqual([]);
    expect(home.summary.communitiesCount).toBe(0);
    expect(home.capabilities.canCreateGroup).toBe(true);
    expect(home.capabilities.canManageAnyCommunity).toBe(false);
  });

  // Owners of a Group created before GroupsService.create started writing
  // the founder's FormalGroupAffiliation have no active affiliation - owning
  // the Group alone must still block creating a second one.
  it('canCreateGroup is false when the user owns a Group but has no active FormalGroupAffiliation', async () => {
    const { service } = buildService({
      participation: [],
      hasActiveFormalGroup: false,
      ownsGroup: true,
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canCreateGroup).toBe(false);
    expect(home.capabilities.canCreateStandaloneSection).toBe(true);
  });

  it('canCreateGroup is false when the user already has an active FormalGroupAffiliation', async () => {
    const { service } = buildService({
      participation: [],
      hasActiveFormalGroup: true,
    });

    const home = await service.getHome(buildUser(), null);

    expect(home.capabilities.canCreateGroup).toBe(false);
    // canCreateStandaloneSection is unaffected - the one-formal-group
    // limit only ever applies to creating a Group.
    expect(home.capabilities.canCreateStandaloneSection).toBe(true);
  });
});
