import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, FilterQuery } from '@mikro-orm/postgresql';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { Group } from '../groups/entities/group.entity';
import { GroupMembership } from '../groups/entities/group-membership.entity';
import { MembershipRequest } from '../groups/entities/membership-request.entity';
import { Section } from '../groups/entities/section.entity';
import { User } from '../users/entities/user.entity';
import {
  Community,
  GroupHierarchyService,
} from '../groups/group-hierarchy.service';
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
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  /**
   * Resolve any resource (Group, Section or User) by its publicCode.
   * Hidden resources ARE returned here - the publicCode bypass is intentional
   * (see spec §4: "wyszukiwanie po poprawnym kodzie ma działać dla isHidden=true").
   */
  async resolveByCode(
    code: string,
    requestingUser: User,
  ): Promise<DiscoveredResourceDto> {
    const normalizedCode = code.toUpperCase();

    const community = await this.findCommunityByPublicCode(normalizedCode);
    if (community) {
      const isMember = await this.checkGroupMembership(
        community,
        requestingUser,
      );
      const hasPendingRequest = await this.checkPendingRequest(
        community.id,
        requestingUser,
      );
      const resourceType = community instanceof Group ? 'GROUP' : 'SECTION';
      return {
        resourceType,
        group: toPublicCommunityProfile(community),
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
   * other two.
   *
   * NOTE (stage-1 organizational-domain rebuild): Group and Section are now
   * two separate tables. A Group has no location fields, so a
   * country/city filter can only ever match a Section - this method
   * queries both tables and merges/paginates the combined result set in
   * application code, rather than one single-table SQL query with
   * LIMIT/OFFSET as before. This is correct but not SQL-side-paginated;
   * revisiting this with a proper cross-table query (or a shared
   * identity/index table) is left to Discovery's own follow-up stage - see
   * the stage-1 migration report.
   */
  async search(
    query: DiscoverySearchQuery,
  ): Promise<PaginatedResponse<CommunitySearchResultDto>> {
    const includeGroups = query.type !== 'SECTION';
    const includeSections = query.type !== 'GROUP';
    // A Group has no location fields (stage-1 rebuild) - a country/city
    // filter can only ever match a Section.
    const groupsEligible = includeGroups && !query.country && !query.city;

    const groupWhere: FilterQuery<Group> = {
      isHidden: false,
      status: GroupStatus.ACTIVE,
    };
    if (query.name) {
      groupWhere.name = { $ilike: `%${query.name}%` };
    }

    const sectionWhere: FilterQuery<Section> = {
      isHidden: false,
      status: GroupStatus.ACTIVE,
    };
    if (query.name) {
      sectionWhere.name = { $ilike: `%${query.name}%` };
    }
    if (query.country) {
      sectionWhere.country = query.country;
    }
    if (query.city) {
      sectionWhere.city = { $ilike: `%${query.city}%` };
    }

    // Sequential, not Promise.all - two queries issued concurrently on the
    // same EntityManager/connection race each other at the driver level.
    const groups = groupsEligible
      ? await this.em.find(Group, groupWhere, { orderBy: { name: 'asc' } })
      : [];
    const sections = includeSections
      ? await this.em.find(Section, sectionWhere, { orderBy: { name: 'asc' } })
      : [];

    const groupIds = groups.map((group) => group.id);
    const sectionsCountByGroupId = await this.countDirectSections(groupIds);

    const combined: CommunitySearchResultDto[] = [
      ...groups.map((group) =>
        toCommunitySearchResultDtoForGroup(
          group,
          sectionsCountByGroupId.get(group.id) ?? 0,
        ),
      ),
      ...sections.map((section) =>
        toCommunitySearchResultDtoForSection(section),
      ),
    ].sort((a, b) => a.name.localeCompare(b.name));

    const totalItems = combined.length;
    const start = (query.page - 1) * query.limit;
    const data = combined.slice(start, start + query.limit);

    return {
      data,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems,
      }),
    };
  }

  // ─── Private helpers ─────────────────────────────────────────────────────

  private async findCommunityByPublicCode(
    publicCode: string,
  ): Promise<Community | null> {
    const group = await this.em.findOne(Group, { publicCode });
    if (group) {
      return group;
    }
    return this.em.findOne(Section, { publicCode });
  }

  // Direct-children count only (not the whole subtree), scoped to just the
  // current page's Group ids - never a per-row N+1, never a full-table
  // aggregate.
  private async countDirectSections(
    groupIds: string[],
  ): Promise<Map<string, number>> {
    if (groupIds.length === 0) {
      return new Map();
    }
    const rows = await this.em
      .getConnection()
      .execute<{ parent_group_id: string; count: string }[]>(
        `select parent_group_id, count(*) as count from sections where parent_group_id in (?) group by parent_group_id`,
        [groupIds],
      );
    return new Map(rows.map((row) => [row.parent_group_id, Number(row.count)]));
  }

  private async checkGroupMembership(
    community: Community,
    user: User,
  ): Promise<boolean> {
    // For Root Groups: check Membership; for Child Groups/Sections: check
    // MEMBER Role - resolveRootGroup centralizes both cases (a standalone
    // Section with no parent has no Root Group, so it can never have a
    // member either).
    let rootGroupId: string;
    try {
      rootGroupId = (
        await this.groupHierarchyService.resolveRootGroup(community)
      ).id;
    } catch {
      return false;
    }

    const membership = await this.em.findOne(GroupMembership, {
      rootGroup: rootGroupId,
      user: user.id,
      status: GroupMembershipStatus.ACTIVE,
    });
    return !!membership;
  }

  private async checkPendingRequest(
    targetGroupId: string,
    user: User,
  ): Promise<boolean> {
    const request = await this.em.findOne(MembershipRequest, {
      $or: [
        {
          $or: [
            { targetGroup: targetGroupId },
            { targetSection: targetGroupId },
          ],
          initiatedBy: user.id,
          status: MembershipRequestStatus.PENDING,
        },
        {
          $or: [
            { targetGroup: targetGroupId },
            { targetSection: targetGroupId },
          ],
          invitedUser: user.id,
          status: MembershipRequestStatus.PENDING,
        },
        {
          $or: [
            { targetGroup: targetGroupId },
            { targetSection: targetGroupId },
          ],
          invitedEmail: user.email,
          status: MembershipRequestStatus.PENDING,
        },
      ],
    });
    return !!request;
  }
}

// ─── Mappers ─────────────────────────────────────────────────────────────────

function toPublicCommunityProfile(community: Community): PublicGroupProfileDto {
  return {
    id: community.id,
    name: community.name,
    description: community.description,
    logoUrl: community.logoUrl,
    coverImageUrl: community.coverImageUrl,
    websiteUrl: community.websiteUrl,
    status: community.status,
    isPublic: community.isPublic,
    isHidden: community.isHidden,
    publicCode: community.publicCode,
    // Type-based, not a `parentGroup === null` check - see the
    // organizational-domain rebuild, stage 1.
    isRootGroup: community instanceof Group && community.parentGroup === null,
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

function toCommunitySearchResultDtoForGroup(
  group: Group,
  directSectionsCount: number,
): CommunitySearchResultDto {
  return {
    id: group.id,
    type: 'GROUP',
    name: group.name,
    publicCode: group.publicCode,
    logoUrl: group.logoUrl,
    country: null,
    city: null,
    description: group.description,
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    status: group.status,
    parentId: group.parentGroup?.id ?? null,
    sectionsCount: directSectionsCount,
  };
}

function toCommunitySearchResultDtoForSection(
  section: Section,
): CommunitySearchResultDto {
  return {
    id: section.id,
    type: 'SECTION',
    name: section.name,
    publicCode: section.publicCode,
    logoUrl: section.logoUrl,
    country: section.country,
    city: section.city,
    description: section.description,
    isPublic: section.isPublic,
    isHidden: section.isHidden,
    status: section.status,
    parentId: section.parentGroup?.id ?? null,
    sectionsCount: null,
  };
}
