import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  CommunityHomeCapabilitiesDto,
  CommunityHomeCommunityDto,
  CommunityHomeResponseDto,
} from './dto/community-home-response.dto';
import { Group } from './entities/group.entity';
import { GroupMembership } from './entities/group-membership.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import {
  toCommunityHomeCommunityDto,
  toCommunityHomeCommunityRefDto,
  toCommunityHomeInvitationDto,
  toCommunityHomeJoinRequestDto,
} from './mappers/community-home.mapper';
import { MembershipRequestsService } from './membership-requests.service';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsService } from './role-assignments.service';

// Dashboard sections are capped, not paginated (Community Home is not a
// management screen - see PAD-001 §10 "Community Home should not contain
// full member lists"). `total`/`hasMore` always describe the full matching
// set so the frontend can render a "See all" link without a second request
// just to learn whether one is needed.
const PENDING_SECTION_LIMIT = 20;

// Every capability id-list this endpoint computes, keyed the same way as
// CommunityHomeCapabilitiesDto (minus the two booleans, which aren't
// per-community lists).
type CapabilityListKey = Exclude<
  keyof CommunityHomeCapabilitiesDto,
  'canCreateGroup' | 'canManageAnyCommunity'
>;

interface ParticipationResult {
  communities: CommunityHomeCommunityDto[];
  communityMap: Map<string, Group>;
  capabilityLists: Record<CapabilityListKey, string[]>;
}

@Injectable()
export class CommunityHomeService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly membershipRequestsService: MembershipRequestsService,
  ) {}

  async getHome(user: User): Promise<CommunityHomeResponseDto> {
    const [participation, invitations] = await Promise.all([
      this.buildParticipation(user.id),
      this.membershipRequestsService.listReceivedInvitations(user),
    ]);
    const { communities, communityMap, capabilityLists } = participation;
    const joinRequestReviewableIds =
      capabilityLists.canReviewJoinRequestsInCommunityIds;

    const allJoinRequests =
      joinRequestReviewableIds.length > 0
        ? await this.membershipRequestsService.listJoinRequestsForGroups(
            joinRequestReviewableIds,
          )
        : [];

    // Invitations target communities the caller does not necessarily
    // belong to yet, so their target groups are usually NOT already in
    // communityMap - fetch whichever ones are missing in a single extra
    // batched query (never one query per invitation).
    const missingGroupIds = [
      ...new Set(
        invitations
          .map((invitation) => invitation.targetGroupId)
          .filter((id) => !communityMap.has(id)),
      ),
    ];
    if (missingGroupIds.length > 0) {
      const extraGroups = await this.em.find(Group, {
        id: { $in: missingGroupIds },
      });
      for (const group of extraGroups) {
        communityMap.set(group.id, group);
      }
    }

    const invitationItems = invitations
      .slice(0, PENDING_SECTION_LIMIT)
      .flatMap((invitation) => {
        const community = communityMap.get(invitation.targetGroupId);
        // The target Group was hard-deleted or is otherwise unresolvable
        // (never expected in practice - Groups are soft-deleted, never
        // removed - but skip defensively rather than crash the dashboard).
        if (!community) return [];
        return [
          toCommunityHomeInvitationDto(
            invitation,
            toCommunityHomeCommunityRefDto(community),
          ),
        ];
      });

    const joinRequestItems = allJoinRequests
      .slice(0, PENDING_SECTION_LIMIT)
      .flatMap((request) => {
        const community = communityMap.get(request.targetGroupId);
        if (!community) return [];
        return [
          toCommunityHomeJoinRequestDto(
            request,
            toCommunityHomeCommunityRefDto(community),
          ),
        ];
      });

    const pendingInvitations = {
      items: invitationItems,
      total: invitations.length,
      hasMore: invitations.length > invitationItems.length,
    };
    const pendingJoinRequests = {
      items: joinRequestItems,
      total: allJoinRequests.length,
      hasMore: allJoinRequests.length > joinRequestItems.length,
    };

    return {
      myCommunities: communities,
      pendingInvitations,
      pendingJoinRequests,
      summary: {
        communitiesCount: communities.length,
        pendingInvitationsCount: pendingInvitations.total,
        pendingJoinRequestsCount: pendingJoinRequests.total,
        actionableItemsCount:
          pendingInvitations.total + pendingJoinRequests.total,
      },
      capabilities: {
        // Creating a Group requires no permission at all - any
        // authenticated user may (see GroupsService.create).
        canCreateGroup: true,
        ...capabilityLists,
        canManageAnyCommunity:
          capabilityLists.canCreateSectionInCommunityIds.length > 0,
      },
    };
  }

  /**
   * Resolves every community (Group or Section, at any hierarchy depth) the
   * caller currently participates in, batched into a fixed number of
   * queries regardless of how many communities that turns out to be, and
   * every capability-flag id-list alongside it in the same pass:
   *   1. the caller's ACTIVE or READ_ONLY (suspended) Memberships (one Group
   *      each) - READ_ONLY is included so a suspended member's communities
   *      remain visible (organization-entities.md#membership: "remains
   *      visible... but loses operational permissions"), exactly like a
   *      READ_ONLY Group already does,
   *   2. every Role Assignment any of those Memberships holds, for any
   *      Group or Section (root or descendant),
   *   3. the Group rows themselves, excluding only DELETED ones - ARCHIVED
   *      Groups ARE fetched here (unlike before) because
   *      canRestoreCommunityIds/canDeleteCommunityIds need to see them, even
   *      though an ARCHIVED Group is still excluded from `communities`
   *      (myCommunities) itself, same as before.
   * A Group always appears even with zero Role Assignments there - an
   * ACTIVE Membership with no Role anywhere is a normal, valid state (see
   * organization-entities.md#membership) and Membership itself is what
   * "belonging to this Group" means.
   */
  private async buildParticipation(
    userId: string,
  ): Promise<ParticipationResult> {
    const memberships = await this.em.find(
      GroupMembership,
      {
        user: userId,
        status: {
          $in: [GroupMembershipStatus.ACTIVE, GroupMembershipStatus.READ_ONLY],
        },
      },
      { populate: ['rootGroup'] },
    );

    const groupIdsByMembership = new Map<string, Set<string>>();
    for (const membership of memberships) {
      groupIdsByMembership.set(
        membership.id,
        new Set([membership.rootGroup.id]),
      );
    }

    const rolesByMembershipAndGroup = new Map<string, GroupRole[]>();
    if (memberships.length > 0) {
      const participation =
        await this.roleAssignmentsService.getGroupParticipationForMemberships(
          memberships.map((membership) => membership.id),
        );
      for (const row of participation) {
        groupIdsByMembership.get(row.membershipId)?.add(row.groupId);
        rolesByMembershipAndGroup.set(
          `${row.membershipId}:${row.groupId}`,
          row.roles,
        );
      }
    }

    const allGroupIds = new Set<string>();
    for (const ids of groupIdsByMembership.values()) {
      for (const id of ids) allGroupIds.add(id);
    }

    const groups =
      allGroupIds.size > 0
        ? await this.em.find(Group, {
            id: { $in: [...allGroupIds] },
            status: { $ne: GroupStatus.DELETED },
          })
        : [];
    const communityMap = new Map(groups.map((group) => [group.id, group]));

    const communities: CommunityHomeCommunityDto[] = [];
    const capabilityLists: Record<CapabilityListKey, string[]> = {
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
    };

    for (const membership of memberships) {
      const rootGroupId = membership.rootGroup.id;
      const groupIds = groupIdsByMembership.get(membership.id) ?? new Set();

      for (const groupId of groupIds) {
        const group = communityMap.get(groupId);
        if (!group) continue; // hard-deleted or otherwise unresolvable

        const roles =
          rolesByMembershipAndGroup.get(`${membership.id}:${groupId}`) ?? [];
        const has = (permission: GroupPermission): boolean =>
          this.groupPermissionService.hasAllPermissionsForRoles(
            roles,
            [permission],
            membership.status,
          );
        const hasAdminOrOwner =
          roles.includes(GroupRole.ADMIN) || roles.includes(GroupRole.OWNER);

        if (group.status !== GroupStatus.ARCHIVED) {
          communities.push(
            toCommunityHomeCommunityDto(group, rootGroupId, roles),
          );
        }

        // Every one of these mirrors the exact @AllowGroupStatuses (or lack
        // thereof, defaulting to ACTIVE-only) on the corresponding endpoint -
        // see groups.controller.ts / audit-log.controller.ts.
        if (has(GroupPermission.GROUP_EDIT)) {
          capabilityLists.canCreateSectionInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.EVENT_CREATE)
        ) {
          capabilityLists.canCreateEventInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.GROUP_JOIN_REQUEST_REVIEW)
        ) {
          capabilityLists.canReviewJoinRequestsInCommunityIds.push(groupId);
        }
        if (has(GroupPermission.MEMBERSHIP_VIEW)) {
          capabilityLists.canViewMembersInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.MEMBERSHIP_REMOVE)
        ) {
          capabilityLists.canManageMembersInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.GROUP_INVITE) &&
          (hasAdminOrOwner || group.memberInvitesAllowed)
        ) {
          capabilityLists.canInviteMembersInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.MEMBERSHIP_INVITE)
        ) {
          capabilityLists.canManageInvitationsInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.MEMBERSHIP_ROLE_CHANGE)
        ) {
          capabilityLists.canManageRolesInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
        ) {
          capabilityLists.canTransferOwnershipInCommunityIds.push(groupId);
        }
        if (
          (group.status === GroupStatus.ACTIVE ||
            group.status === GroupStatus.READ_ONLY) &&
          has(GroupPermission.GROUP_ARCHIVE)
        ) {
          capabilityLists.canArchiveCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ARCHIVED &&
          has(GroupPermission.GROUP_UNARCHIVE)
        ) {
          capabilityLists.canRestoreCommunityIds.push(groupId);
        }
        if (
          group.status !== GroupStatus.DELETED &&
          has(GroupPermission.GROUP_DELETE)
        ) {
          capabilityLists.canDeleteCommunityIds.push(groupId);
        }
        if (has(GroupPermission.AUDIT_LOG_VIEW)) {
          capabilityLists.canViewAuditLogInCommunityIds.push(groupId);
        }
        // Deliberately Role/Permission-independent - every ACTIVE Membership
        // manages its own notification settings regardless of Role (see
        // CommunityNotificationSettingsService) - a suspended (READ_ONLY)
        // Membership does not, consistent with every other operational
        // capability here.
        if (membership.status === GroupMembershipStatus.ACTIVE) {
          capabilityLists.canManageNotificationsInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.MEMBERSHIP_BAN)
        ) {
          capabilityLists.canBanMembersInCommunityIds.push(groupId);
        }
        if (
          group.status === GroupStatus.ACTIVE &&
          has(GroupPermission.MEMBERSHIP_SUSPEND)
        ) {
          capabilityLists.canSuspendMembersInCommunityIds.push(groupId);
        }
      }
    }

    communities.sort((a, b) => {
      const rootA = communityMap.get(a.rootGroupId)?.name ?? '';
      const rootB = communityMap.get(b.rootGroupId)?.name ?? '';
      if (rootA !== rootB) return rootA.localeCompare(rootB);
      if (a.isRootGroup !== b.isRootGroup) return a.isRootGroup ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { communities, communityMap, capabilityLists };
  }
}
