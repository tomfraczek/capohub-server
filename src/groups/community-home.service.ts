import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
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

interface ParticipationResult {
  communities: CommunityHomeCommunityDto[];
  communityMap: Map<string, Group>;
  // Groups where the caller can currently create a Child Group (holds
  // GROUP_EDIT there). Mirrors GroupsService.create's
  // loadUsableParentForCreation, which only rejects an ARCHIVED parent -
  // READ_ONLY parents are allowed - so no extra status filter beyond
  // excluding ARCHIVED (already applied when `communityMap` is built).
  canCreateGroupIds: string[];
  // Groups where the caller can currently act on (approve/reject) pending
  // join requests. Unlike listing them (GET .../join-requests allows any
  // status), approveJoinRequest/rejectJoinRequest have no
  // @AllowGroupStatuses override, so they default to ACTIVE-only
  // (fail-closed - see GroupPermissionsGuard). A READ_ONLY community is
  // therefore excluded here even though its Role Assignments would
  // otherwise grant GROUP_JOIN_REQUEST_REVIEW.
  joinRequestReviewableIds: string[];
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
    const {
      communities,
      communityMap,
      canCreateGroupIds,
      joinRequestReviewableIds,
    } = participation;

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
        // Creating a Root Group requires no permission at all - any
        // authenticated user may (see GroupsService.create).
        canCreateOrganization: true,
        canCreateGroupInCommunityIds: canCreateGroupIds,
        canReviewJoinRequestsInCommunityIds: joinRequestReviewableIds,
        canManageAnyCommunity: canCreateGroupIds.length > 0,
      },
    };
  }

  /**
   * Resolves every community (Organization or Group, at any hierarchy
   * depth) the caller currently participates in, batched into a fixed
   * number of queries regardless of how many communities that turns out to
   * be:
   *   1. the caller's ACTIVE Memberships (one Root Group each),
   *   2. every Role Assignment any of those Memberships holds, for any
   *      Group (root or descendant),
   *   3. the Group rows themselves, excluding ARCHIVED ones.
   * An Organization always appears even with zero Role Assignments there -
   * an ACTIVE Membership with no Role anywhere is a normal, valid state
   * (see organization-entities.md#membership) and Membership itself is
   * what "belonging to this Organization" means.
   */
  private async buildParticipation(
    userId: string,
  ): Promise<ParticipationResult> {
    const memberships = await this.em.find(
      GroupMembership,
      { user: userId, status: GroupMembershipStatus.ACTIVE },
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
            status: { $ne: GroupStatus.ARCHIVED },
          })
        : [];
    const communityMap = new Map(groups.map((group) => [group.id, group]));

    const communities: CommunityHomeCommunityDto[] = [];
    const canCreateGroupIds: string[] = [];
    const joinRequestReviewableIds: string[] = [];

    for (const membership of memberships) {
      const rootGroupId = membership.rootGroup.id;
      const groupIds = groupIdsByMembership.get(membership.id) ?? new Set();

      for (const groupId of groupIds) {
        const group = communityMap.get(groupId);
        if (!group) continue; // archived, so excluded from the dashboard

        const roles =
          rolesByMembershipAndGroup.get(`${membership.id}:${groupId}`) ?? [];
        communities.push(
          toCommunityHomeCommunityDto(group, rootGroupId, roles),
        );

        if (
          this.groupPermissionService.hasAllPermissionsForRoles(
            roles,
            [GroupPermission.GROUP_EDIT],
            membership.status,
          )
        ) {
          canCreateGroupIds.push(groupId);
        }

        if (
          group.status === GroupStatus.ACTIVE &&
          this.groupPermissionService.hasAllPermissionsForRoles(
            roles,
            [GroupPermission.GROUP_JOIN_REQUEST_REVIEW],
            membership.status,
          )
        ) {
          joinRequestReviewableIds.push(groupId);
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

    return {
      communities,
      communityMap,
      canCreateGroupIds,
      joinRequestReviewableIds,
    };
  }
}
