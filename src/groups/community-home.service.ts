import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  CommunityHomeCapabilitiesDto,
  CommunityHomeCommunityDto,
  CommunityHomeResponseDto,
} from './dto/community-home-response.dto';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { Community, GroupHierarchyService } from './group-hierarchy.service';
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
import { R2StorageService } from '../storage/r2-storage.service';

// Dashboard sections are capped, not paginated (Community Home is not a
// management screen). `total`/`hasMore` always describe the full matching
// set so the frontend can render a "See all" link without a second request
// just to learn whether one is needed.
const PENDING_SECTION_LIMIT = 20;

// Every capability id-list this endpoint computes, keyed the same way as
// CommunityHomeCapabilitiesDto (minus the two booleans, which aren't
// per-community lists).
type CapabilityListKey = Exclude<
  keyof CommunityHomeCapabilitiesDto,
  'canCreateGroup' | 'canCreateStandaloneSection' | 'canManageAnyCommunity'
>;

interface ParticipationResult {
  communities: CommunityHomeCommunityDto[];
  communityMap: Map<string, Community>;
  capabilityLists: Record<CapabilityListKey, string[]>;
}

@Injectable()
export class CommunityHomeService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly membershipRequestsService: MembershipRequestsService,
    private readonly r2StorageService: R2StorageService,
  ) {}

  async getHome(user: User): Promise<CommunityHomeResponseDto> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level.
    const participation = await this.buildParticipation(user.id);
    const invitations =
      await this.membershipRequestsService.listReceivedInvitations(user);
    const { communities, communityMap, capabilityLists } = participation;
    const joinRequestReviewableIds =
      capabilityLists.canReviewJoinRequestsInSectionIds;

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
      const extraCommunities = await this.findCommunitiesByIds(missingGroupIds);
      for (const community of extraCommunities) {
        communityMap.set(community.id, community);
      }
    }

    const invitationItems = invitations
      .slice(0, PENDING_SECTION_LIMIT)
      .flatMap((invitation) => {
        const community = communityMap.get(invitation.targetGroupId);
        // The target Group/Section was hard-deleted or is otherwise
        // unresolvable (never expected in practice - communities are
        // soft-deleted, never removed - but skip defensively rather than
        // crash the dashboard).
        if (!community) return [];
        return [
          toCommunityHomeInvitationDto(
            invitation,
            toCommunityHomeCommunityRefDto(community, this.r2StorageService),
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
            toCommunityHomeCommunityRefDto(community, this.r2StorageService),
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
        // authenticated user may (see GroupsService.create). Same for a
        // standalone Section (no parent Group) - see
        // SectionsService.createStandalone and ADR-032.
        canCreateGroup: true,
        canCreateStandaloneSection: true,
        ...capabilityLists,
        canManageAnyCommunity:
          capabilityLists.canCreateSectionInGroupIds.length > 0 ||
          capabilityLists.canCreateSectionInSectionIds.length > 0,
      },
    };
  }

  // Role Assignment participation can point at a Group or a Section - see
  // group-hierarchy.service.ts - resolves a batch of ids against both
  // tables, sequentially (not Promise.all - see this file's other
  // queries).
  private async findCommunitiesByIds(ids: string[]): Promise<Community[]> {
    const groups = await this.em.find(Group, { id: { $in: ids } });
    const sections = await this.em.find(Section, { id: { $in: ids } });
    return [...groups, ...sections];
  }

  /**
   * Resolves every community (Group or Section) the caller currently holds
   * any active Role Assignment for, batched into a fixed number of queries,
   * and every capability-flag id-list alongside it in the same pass. No
   * inheritance anywhere: a Role held on one Group/Section never adds any
   * other community to this list, and each capability list only ever
   * contains ids where the underlying permission was computed directly
   * against that exact community (see
   * RoleAssignmentsService.getCommunityIdsWithAnyRole's own comment).
   */
  private async buildParticipation(
    userId: string,
  ): Promise<ParticipationResult> {
    const participation =
      await this.roleAssignmentsService.getGroupParticipationForUsers([userId]);

    const communityList =
      participation.length > 0
        ? await this.findCommunitiesByIds(
            participation.map((row) => row.groupId),
          )
        : [];
    const communityMap = new Map(
      communityList
        .filter((community) => community.status !== GroupStatus.DELETED)
        .map((community) => [community.id, community]),
    );

    // Section membership statuses - needed to gate Section capabilities
    // (ACTIVE vs READ_ONLY) the same way GroupPermissionsGuard does. Group
    // participation has no membership/status to look up at all.
    const sectionIds = participation
      .map((row) => row.groupId)
      .filter((id) => communityMap.get(id) instanceof Section);
    const sectionMembershipBysection = new Map<string, SectionMembership>();
    if (sectionIds.length > 0) {
      const memberships = await this.em.find(SectionMembership, {
        user: userId,
        section: { $in: sectionIds },
        status: {
          $in: [
            SectionMembershipStatus.ACTIVE,
            SectionMembershipStatus.READ_ONLY,
          ],
        },
      });
      for (const membership of memberships) {
        sectionMembershipBysection.set(membership.section.id, membership);
      }
    }

    const communities: CommunityHomeCommunityDto[] = [];
    const capabilityLists: Record<CapabilityListKey, string[]> = {
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
    };

    const rootGroupIdCache = new Map<string, string>();
    const resolveRootGroupId = async (
      community: Community,
    ): Promise<string> => {
      const cached = rootGroupIdCache.get(community.id);
      if (cached) return cached;
      let rootId: string;
      try {
        rootId = (
          await this.groupHierarchyService.resolveRootGroup(community, this.em)
        ).id;
      } catch {
        // A standalone Section with no parent yet has no root Group -
        // group it under itself rather than failing the whole dashboard.
        rootId = community.id;
      }
      rootGroupIdCache.set(community.id, rootId);
      return rootId;
    };

    for (const row of participation) {
      const community = communityMap.get(row.groupId);
      if (!community) continue; // hard-deleted or otherwise unresolvable

      const isGroup = community instanceof Group;
      const membership = isGroup
        ? null
        : (sectionMembershipBysection.get(community.id) ?? null);
      // A Section row only appears in `participation` at all when an
      // active RoleAssignment exists, which (per the atomic
      // membership+MEMBER pairing invariant) implies an active membership
      // too - `membership === null` here would mean that invariant broke,
      // so skip defensively rather than crash the dashboard.
      if (!isGroup && !membership) continue;

      const has = (permission: GroupPermission): boolean =>
        this.groupPermissionService.hasAllPermissionsForRoles(
          isGroup ? 'GROUP' : 'SECTION',
          row.roles,
          [permission],
          membership?.status ?? null,
        );
      const hasAdminOrOwner =
        row.roles.includes(GroupRole.ADMIN) ||
        row.roles.includes(GroupRole.OWNER);
      const push = (key: CapabilityListKey): void => {
        capabilityLists[key].push(community.id);
      };

      if (community.status !== GroupStatus.ARCHIVED) {
        const rootGroupId = await resolveRootGroupId(community);
        communities.push(
          toCommunityHomeCommunityDto(
            community,
            rootGroupId,
            row.roles,
            this.r2StorageService,
          ),
        );
      }

      // Every one of these mirrors the exact @AllowGroupStatuses (or lack
      // thereof, defaulting to ACTIVE-only) on the corresponding endpoint.
      if (has(GroupPermission.GROUP_EDIT)) {
        push(
          isGroup
            ? 'canCreateSectionInGroupIds'
            : 'canCreateSectionInSectionIds',
        );
      }
      if (
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.EVENT_CREATE)
      ) {
        push(
          isGroup ? 'canCreateEventInGroupIds' : 'canCreateEventInSectionIds',
        );
      }
      if (
        !isGroup &&
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.GROUP_JOIN_REQUEST_REVIEW)
      ) {
        push('canReviewJoinRequestsInSectionIds');
      }
      if (!isGroup && has(GroupPermission.MEMBERSHIP_VIEW)) {
        push('canViewMembersInSectionIds');
      }
      if (
        !isGroup &&
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.MEMBERSHIP_REMOVE)
      ) {
        push('canManageMembersInSectionIds');
      }
      if (
        !isGroup &&
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.GROUP_INVITE) &&
        (hasAdminOrOwner ||
          (community instanceof Section && community.memberInvitesAllowed))
      ) {
        push('canInviteMembersInSectionIds');
      }
      if (
        !isGroup &&
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.MEMBERSHIP_INVITE)
      ) {
        push('canManageInvitationsInSectionIds');
      }
      if (
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.GROUP_EDIT)
      ) {
        push(
          isGroup ? 'canManageRolesInGroupIds' : 'canManageRolesInSectionIds',
        );
      }
      if (
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
      ) {
        push(
          isGroup
            ? 'canTransferOwnershipInGroupIds'
            : 'canTransferOwnershipInSectionIds',
        );
      }
      if (
        (community.status === GroupStatus.ACTIVE ||
          community.status === GroupStatus.READ_ONLY) &&
        has(GroupPermission.GROUP_ARCHIVE)
      ) {
        push(isGroup ? 'canArchiveGroupIds' : 'canArchiveSectionIds');
      }
      if (
        community.status === GroupStatus.ARCHIVED &&
        has(GroupPermission.GROUP_UNARCHIVE)
      ) {
        push(isGroup ? 'canRestoreGroupIds' : 'canRestoreSectionIds');
      }
      if (
        community.status !== GroupStatus.DELETED &&
        has(GroupPermission.GROUP_DELETE)
      ) {
        push(isGroup ? 'canDeleteGroupIds' : 'canDeleteSectionIds');
      }
      if (has(GroupPermission.AUDIT_LOG_VIEW)) {
        push(
          isGroup ? 'canViewAuditLogInGroupIds' : 'canViewAuditLogInSectionIds',
        );
      }
      // Deliberately Role/Permission-independent - every ACTIVE
      // SectionMembership manages its own notification settings
      // regardless of Role (see CommunityNotificationSettingsService) - a
      // suspended (READ_ONLY) membership does not. Group has no
      // membership, so never appears here.
      if (!isGroup && membership?.status === SectionMembershipStatus.ACTIVE) {
        push('canManageNotificationsInSectionIds');
      }
      if (
        !isGroup &&
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.MEMBERSHIP_BAN)
      ) {
        push('canBanMembersInSectionIds');
      }
      if (
        !isGroup &&
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.MEMBERSHIP_SUSPEND)
      ) {
        push('canSuspendMembersInSectionIds');
      }
      if (
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.ANNOUNCEMENT_MANAGE)
      ) {
        push(
          isGroup
            ? 'canManageAnnouncementsInGroupIds'
            : 'canManageAnnouncementsInSectionIds',
        );
      }
      if (has(GroupPermission.ANNOUNCEMENT_ARCHIVE_VIEW)) {
        push(
          isGroup
            ? 'canViewAnnouncementArchiveInGroupIds'
            : 'canViewAnnouncementArchiveInSectionIds',
        );
      }
      if (has(GroupPermission.RECIPIENT_GROUP_VIEW)) {
        push(
          isGroup
            ? 'canViewRecipientGroupsInGroupIds'
            : 'canViewRecipientGroupsInSectionIds',
        );
      }
      if (
        community.status === GroupStatus.ACTIVE &&
        has(GroupPermission.RECIPIENT_GROUP_MANAGE)
      ) {
        push(
          isGroup
            ? 'canManageRecipientGroupsInGroupIds'
            : 'canManageRecipientGroupsInSectionIds',
        );
      }
      // Training/TrainingSeries create+manage and Stats-viewing are all
      // Section-only and gate on the same TRAINING_MANAGE permission at the
      // endpoint level - computed once and pushed to all three lists
      // instead of repeating the identical has() check three times.
      if (!isGroup && community.status === GroupStatus.ACTIVE) {
        if (has(GroupPermission.TRAINING_MANAGE)) {
          push('canCreateTrainingInSectionIds');
          push('canCreateTrainingSeriesInSectionIds');
          push('canManageTrainingSeriesInSectionIds');
        }
        if (has(GroupPermission.TRAINING_STATS_VIEW)) {
          push('canViewTrainingStatsInSectionIds');
        }
      }
    }

    communities.sort((a, b) => {
      const rootA = communityMap.get(a.rootGroupId)?.name ?? '';
      const rootB = communityMap.get(b.rootGroupId)?.name ?? '';
      if (rootA !== rootB) return rootA.localeCompare(rootB);
      if (a.isGroup !== b.isGroup) return a.isGroup ? -1 : 1;
      return a.name.localeCompare(b.name);
    });

    return { communities, communityMap, capabilityLists };
  }
}
