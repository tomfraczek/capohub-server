import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Group } from '../groups/entities/group.entity';
import { GroupMembership } from '../groups/entities/group-membership.entity';
import { MembershipRequest } from '../groups/entities/membership-request.entity';
import { User } from '../users/entities/user.entity';
import { GroupMembershipStatus } from '../groups/enums/group-membership-status.enum';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { MembershipRequestStatus } from '../groups/enums/membership-request-status.enum';
import {
  DiscoveredResourceDto,
  PublicGroupProfileDto,
  PublicUserProfileDto,
} from './discovery-response.dto';

@Injectable()
export class DiscoveryService {
  constructor(private readonly em: EntityManager) {}

  /**
   * Resolve any resource (Group or User) by its publicCode.
   * Hidden resources ARE returned here - the publicCode bypass is intentional
   * (see spec §4: "wyszukiwanie po poprawnym kodzie ma działać dla isHidden=true").
   */
  async resolveByCode(
    code: string,
    requestingUser: User,
  ): Promise<DiscoveredResourceDto> {
    const normalizedCode = code.toUpperCase();

    // Try Group first
    const group = await this.em.findOne(Group, { publicCode: normalizedCode });
    if (group) {
      const isMember = await this.checkGroupMembership(group, requestingUser);
      const hasPendingRequest = await this.checkPendingRequest(
        group.id,
        requestingUser,
      );
      // Root Groups (parentGroup === null) represent Organizations (ADR-001).
      // The client uses this to decide which targetType to send on join.
      const resourceType =
        group.parentGroup === null ? 'ORGANIZATION' : 'GROUP';
      return {
        resourceType,
        group: toPublicGroupProfile(group),
        user: null,
        isMember,
        hasPendingRequest,
      };
    }

    // Try User
    const user = await this.em.findOne(User, { publicCode: normalizedCode });
    if (user) {
      return {
        resourceType: 'USER',
        group: null,
        user: toPublicUserProfile(user),
        isMember: false,
        hasPendingRequest: false,
      };
    }

    throw new NotFoundException({
      code: 'RESOURCE_NOT_FOUND',
      message: 'No resource found with the given public code',
    });
  }

  /**
   * Search visible Groups (isHidden = false, status = ACTIVE).
   * Optional query param `q` filters by name (case-insensitive, partial).
   */
  async searchVisibleGroups(
    query: string | undefined,
    requestingUser: User,
  ): Promise<DiscoveredResourceDto[]> {
    const where: Record<string, unknown> = {
      isHidden: false,
      status: GroupStatus.ACTIVE,
    };
    if (query && query.trim().length > 0) {
      where.name = { $ilike: `%${query.trim()}%` };
    }

    const groups = await this.em.find(Group, where, {
      orderBy: { name: 'asc' },
      limit: 50,
    });

    return Promise.all(
      groups.map(async (group) => {
        const isMember = await this.checkGroupMembership(group, requestingUser);
        const hasPendingRequest = await this.checkPendingRequest(
          group.id,
          requestingUser,
        );
        // Search only returns isHidden=false groups, so all results are Child
        // or Root Groups that opted into visibility.  Still set resourceType
        // correctly so clients get consistent responses.
        const resourceType =
          group.parentGroup === null
            ? ('ORGANIZATION' as const)
            : ('GROUP' as const);
        return {
          resourceType,
          group: toPublicGroupProfile(group),
          user: null,
          isMember,
          hasPendingRequest,
        };
      }),
    );
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async checkGroupMembership(
    group: Group,
    user: User,
  ): Promise<boolean> {
    // For Root Groups: check Membership; for Child Groups: check MEMBER Role
    const rootGroupId = group.parentGroup
      ? await this.em
          .findOne(Group, { id: group.id })
          .then(() => this.resolveRootGroupId(group.id))
      : group.id;

    const membership = await this.em.findOne(GroupMembership, {
      rootGroup: rootGroupId,
      user: user.id,
      status: GroupMembershipStatus.ACTIVE,
    });
    return !!membership;
  }

  private async resolveRootGroupId(groupId: string): Promise<string> {
    const group = await this.em.findOne(Group, { id: groupId });
    if (!group) return groupId;
    if (!group.parentGroup) return groupId;
    return this.resolveRootGroupId(group.parentGroup.id);
  }

  private async checkPendingRequest(
    targetGroupId: string,
    user: User,
  ): Promise<boolean> {
    const request = await this.em.findOne(MembershipRequest, {
      $or: [
        {
          targetGroup: targetGroupId,
          initiatedBy: user.id,
          status: MembershipRequestStatus.PENDING,
        },
        {
          targetGroup: targetGroupId,
          invitedUser: user.id,
          status: MembershipRequestStatus.PENDING,
        },
        {
          targetGroup: targetGroupId,
          invitedEmail: user.email,
          status: MembershipRequestStatus.PENDING,
        },
      ],
    });
    return !!request;
  }
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toPublicGroupProfile(group: Group): PublicGroupProfileDto {
  return {
    id: group.id,
    name: group.name,
    description: group.description,
    logoUrl: group.logoUrl,
    coverImageUrl: group.coverImageUrl,
    websiteUrl: group.websiteUrl,
    status: group.status,
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    publicCode: group.publicCode,
    // Root Groups (parentGroup === null) represent Organizations (ADR-001).
    // The FK is null if and only if the DB row has no parent_group_id,
    // which is set during entity load without needing to populate the
    // relation object.  A Reference proxy is non-null even before population,
    // so this check correctly distinguishes Root from Child Groups.
    isOrganization: group.parentGroup === null,
  };
}

function toPublicUserProfile(user: User): PublicUserProfileDto {
  return {
    id: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    publicCode: user.publicCode,
  };
}
