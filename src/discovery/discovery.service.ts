import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
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
import { CommunitySearchResultDto } from './dto/community-search-result.dto';
import { DiscoverySearchQuery } from './dto/discovery-search-query.schema';

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
      // A root Group (parentGroup === null) is presented as "Group"; any
      // other depth is a "Section" (see the Group/Section rename ADR). The
      // client uses this to decide which targetType to send on join.
      const resourceType = group.parentGroup === null ? 'GROUP' : 'SECTION';
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
   * "Discover Community" search - the only way to browse Groups/Sections;
   * there is deliberately no unfiltered "list everything" endpoint (see the
   * Group/Section rename ADR). `discoverySearchQuerySchema` already
   * guarantees at least one of name/country/city is present before this
   * ever runs. Only visible rows (isHidden = false, status = ACTIVE) are
   * ever returned - same visibility rule the old ad-hoc search used.
   *
   * Three calls build the "All / Groups / Sections" tabs on the client:
   * omit `type` for "All", or pass `type=GROUP`/`type=SECTION` for the
   * other two - a single call cannot honor independent pagination per
   * sub-list, so this is the only shape consistent with this codebase's
   * `PaginatedResponse<T>` contract (see audit-log.service.ts for the same
   * pattern).
   */
  async search(
    query: DiscoverySearchQuery,
  ): Promise<PaginatedResponse<CommunitySearchResultDto>> {
    const where: Record<string, unknown> = {
      isHidden: false,
      status: GroupStatus.ACTIVE,
    };
    if (query.name) {
      where.name = { $ilike: `%${query.name}%` };
    }
    if (query.country) {
      where.country = query.country;
    }
    if (query.city) {
      where.city = { $ilike: `%${query.city}%` };
    }
    if (query.type === 'GROUP') {
      where.parentGroup = null;
    } else if (query.type === 'SECTION') {
      where.parentGroup = { $ne: null };
    }

    const [groups, totalItems] = await this.em.findAndCount(Group, where, {
      orderBy: { name: 'asc' },
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });

    const groupOnlyIds = groups
      .filter((group) => group.parentGroup === null)
      .map((group) => group.id);
    const sectionsCountByGroupId = await this.countDirectSections(groupOnlyIds);

    return {
      data: groups.map((group) =>
        toCommunitySearchResultDto(
          group,
          sectionsCountByGroupId.get(group.id) ?? null,
        ),
      ),
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems,
      }),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  // Direct-children count only (not the whole subtree), scoped to just the
  // current page's Group ids - never a per-row N+1, never a full-table
  // aggregate. No existing precedent for a grouped-count query in this
  // codebase, so this uses the connection directly rather than the ORM
  // query builder.
  private async countDirectSections(
    groupIds: string[],
  ): Promise<Map<string, number>> {
    if (groupIds.length === 0) {
      return new Map();
    }
    const rows = await this.em
      .getConnection()
      .execute<{ parent_group_id: string; count: string }[]>(
        `select parent_group_id, count(*) as count from groups where parent_group_id in (?) group by parent_group_id`,
        [groupIds],
      );
    return new Map(rows.map((row) => [row.parent_group_id, Number(row.count)]));
  }

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
    // The FK is null if and only if the DB row has no parent_group_id,
    // which is set during entity load without needing to populate the
    // relation object.  A Reference proxy is non-null even before
    // population, so this check correctly distinguishes a root Group
    // ("Group") from a non-root one ("Section" - see the Group/Section
    // rename ADR).
    isRootGroup: group.parentGroup === null,
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

function toCommunitySearchResultDto(
  group: Group,
  sectionsCount: number | null,
): CommunitySearchResultDto {
  const isRootGroup = group.parentGroup === null;
  return {
    id: group.id,
    type: isRootGroup ? 'GROUP' : 'SECTION',
    name: group.name,
    publicCode: group.publicCode,
    logoUrl: group.logoUrl,
    country: group.country,
    city: group.city,
    description: group.description,
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    status: group.status,
    parentId: isRootGroup ? null : group.parentGroup!.id,
    sectionsCount: isRootGroup ? (sectionsCount ?? 0) : null,
  };
}
