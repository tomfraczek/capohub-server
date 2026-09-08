import { Injectable } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { haversineKm, nearbyBoundingBox } from '../common/geo/distance';
import { R2StorageService } from '../storage/r2-storage.service';
import { UserDiscoveryLocation } from '../users/entities/user-discovery-location.entity';
import {
  DEFAULT_NEARBY_RADIUS_KM,
  DISCOVERY_CANDIDATE_SCAN_LIMIT,
  MAX_NEARBY_RADIUS_KM,
  NEARBY_CANDIDATE_SCAN_LIMIT,
} from './community-overview.constants';
import {
  CommunityGroupCardDto,
  CommunityLocationSummaryDto,
  CommunityOverviewBoundedSectionDto,
  CommunitySectionCardDto,
  NearbyGroupCardDto,
  NearbySectionCardDto,
} from './dto/community-overview-response.dto';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { GroupStatus } from './enums/group-status.enum';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupFollowService } from './group-follow.service';
import {
  toCommunityGroupCardDto,
  toCommunitySectionCardDto,
  toNearbyGroupCardDto,
  toNearbySectionCardDto,
} from './mappers/community-overview.mapper';

export interface PageParams {
  limit: number;
  offset: number;
}

export interface NearbyPageParams extends PageParams {
  radiusKm?: number;
}

interface SectionRelationEntry {
  isMemberThroughSection: boolean;
  isFollowing: boolean;
}

interface SectionDistanceCandidate {
  section: Section;
  distanceKm: number;
}

interface SectionDiscoveryCandidate extends SectionDistanceCandidate {
  memberCount: number;
}

function emptyBoundedSection<T>(): CommunityOverviewBoundedSectionDto<T> {
  return { items: [], total: 0, hasMore: false };
}

const ACTIVE_MEMBERSHIP_STATUSES = [
  SectionMembershipStatus.ACTIVE,
  SectionMembershipStatus.READ_ONLY,
];

/**
 * Backs the "member/follower overview + nearby discovery" half of the
 * Community domain: GET /community/home's location/mySections/myGroups/
 * nearbySections/nearbyGroups blocks, and the paginated
 * GET /community/{sections,groups}/{mine,nearby} "see all" endpoints - one
 * shared implementation behind both (see each method's own comment), so
 * Home's capped cards and the full paginated lists can never drift apart on
 * what counts as "mine" or "nearby".
 *
 * Membership here means exactly what the rest of this module already means
 * by it: a Group has no ordinary members at all (only OWNER/ADMIN Role
 * Assignments) - "belonging to" a Group is entirely derived from an active
 * SectionMembership in one of that Group's *direct* Sections
 * (`section.parentGroup === group.id`), never the whole hierarchy subtree -
 * same "no inheritance in either direction" rule GroupsService.
 * resolveViewerRelation and CommunityHomeService already follow.
 */
@Injectable()
export class CommunityOverviewService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupFollowService: GroupFollowService,
    private readonly r2StorageService: R2StorageService,
  ) {}

  /**
   * GET /community/home's `location` block. Row-presence in
   * UserDiscoveryLocation is "configured" - see that entity's own comment.
   */
  async getLocationSummary(
    userId: string,
  ): Promise<CommunityLocationSummaryDto> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: userId,
    });
    if (!location) {
      return { configured: false };
    }
    return {
      configured: true,
      city: location.city,
      region: location.region ?? undefined,
      countryCode: location.countryCode,
    };
  }

  /** mySections - every Section the caller holds an active membership in. */
  async getMySections(
    userId: string,
    page: PageParams,
  ): Promise<CommunityOverviewBoundedSectionDto<CommunitySectionCardDto>> {
    const sectionIds = await this.listMySectionIds(userId);
    if (sectionIds.length === 0) {
      return { items: [], total: 0, hasMore: false };
    }
    const [sections, total] = await this.em.findAndCount(
      Section,
      { id: { $in: sectionIds } },
      {
        orderBy: { name: 'asc', id: 'asc' },
        limit: page.limit,
        offset: page.offset,
      },
    );
    return {
      items: sections.map((section) =>
        toCommunitySectionCardDto(section, this.r2StorageService),
      ),
      total,
      hasMore: page.offset + sections.length < total,
    };
  }

  /**
   * myGroups - every Group the caller is related to through a direct
   * Section membership and/or an explicit GroupFollow, deduplicated to one
   * row per Group id (module: "Grupa występuje tylko raz").
   */
  async getMyGroups(
    userId: string,
    page: PageParams,
  ): Promise<CommunityOverviewBoundedSectionDto<CommunityGroupCardDto>> {
    const { relationByGroupId } = await this.resolveMyGroupRelations(userId);
    const groupIds = [...relationByGroupId.keys()];
    if (groupIds.length === 0) {
      return { items: [], total: 0, hasMore: false };
    }

    const groups = await this.em.find(Group, { id: { $in: groupIds } });
    groups.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    const total = groups.length;
    const pageItems = groups.slice(page.offset, page.offset + page.limit);

    return {
      items: pageItems.map((group) =>
        toCommunityGroupCardDto(
          group,
          relationByGroupId.get(group.id)!,
          this.r2StorageService,
        ),
      ),
      total,
      hasMore: page.offset + pageItems.length < total,
    };
  }

  /**
   * nearbySections - Sections within `radiusKm` of the caller's own
   * discovery location, ranked `distance ASC`, excluding every Section the
   * caller already belongs to. Empty (never an error) when no location is
   * configured (module: "Jeżeli użytkownik nie ma ustawionej lokalizacji ...
   * nearbySections i nearbyGroups powinny być puste").
   */
  async getNearbySections(
    userId: string,
    page: NearbyPageParams,
  ): Promise<CommunityOverviewBoundedSectionDto<NearbySectionCardDto>> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: userId,
    });
    if (!location) {
      return { items: [], total: 0, hasMore: false };
    }

    const mySectionIds = new Set(await this.listMySectionIds(userId));
    const candidates = (
      await this.findNearbySectionCandidates(
        location,
        this.resolveRadiusKm(page.radiusKm),
      )
    ).filter((candidate) => !mySectionIds.has(candidate.section.id));

    const total = candidates.length;
    const pageItems = candidates.slice(page.offset, page.offset + page.limit);

    return {
      items: pageItems.map((candidate) =>
        toNearbySectionCardDto(
          candidate.section,
          candidate.distanceKm,
          this.r2StorageService,
        ),
      ),
      total,
      hasMore: page.offset + pageItems.length < total,
    };
  }

  /**
   * nearbyGroups - a Group qualifies once at least one of its Sections is
   * within `radiusKm`; its distance is its *nearest* qualifying Section's
   * distance (module: "Dystans grupy = dystans do jej najbliższej sekcji").
   * Never includes a Group already in myGroups (module: "Nie pokazuj tutaj
   * grup, które znajdują się już w myGroups") - a Group with no Section
   * carrying coordinates, or none within radius, never appears at all
   * (module: "Grupy bez sekcji posiadających lokalizację nie powinny
   * pojawiać się w nearby discovery").
   */
  async getNearbyGroups(
    userId: string,
    page: NearbyPageParams,
  ): Promise<CommunityOverviewBoundedSectionDto<NearbyGroupCardDto>> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: userId,
    });
    if (!location) {
      return { items: [], total: 0, hasMore: false };
    }

    const { relationByGroupId } = await this.resolveMyGroupRelations(userId);
    const candidates = await this.findNearbySectionCandidates(
      location,
      this.resolveRadiusKm(page.radiusKm),
    );

    interface Aggregate {
      group: Group;
      nearestSection: Section;
      distanceKm: number;
      sectionsCountInRadius: number;
    }
    const byGroupId = new Map<string, Aggregate>();
    for (const candidate of candidates) {
      const group = candidate.section.parentGroup;
      if (!group || relationByGroupId.has(group.id)) {
        continue;
      }
      const existing = byGroupId.get(group.id);
      if (!existing) {
        byGroupId.set(group.id, {
          group,
          nearestSection: candidate.section,
          distanceKm: candidate.distanceKm,
          sectionsCountInRadius: 1,
        });
        continue;
      }
      existing.sectionsCountInRadius += 1;
      if (candidate.distanceKm < existing.distanceKm) {
        existing.nearestSection = candidate.section;
        existing.distanceKm = candidate.distanceKm;
      }
    }

    const aggregates = [...byGroupId.values()].sort(
      (a, b) => a.distanceKm - b.distanceKm,
    );
    const total = aggregates.length;
    const pageItems = aggregates.slice(page.offset, page.offset + page.limit);

    return {
      items: pageItems.map((aggregate) =>
        toNearbyGroupCardDto(
          aggregate.group,
          aggregate.nearestSection,
          aggregate.distanceKm,
          aggregate.sectionsCountInRadius,
          this.r2StorageService,
        ),
      ),
      total,
      hasMore: page.offset + pageItems.length < total,
    };
  }

  // ─── Discovery fallback (COUNTRY tier - see CommunityDiscoveryContextDto's
  // own comment) - only ever invoked by CommunityHomeService.getHome once
  // BOTH nearbySections and nearbyGroups (at DEFAULT_NEARBY_RADIUS_KM) and
  // their EXPANDED_NEARBY_RADIUS_KM retry came back empty. Unlike
  // getNearbySections/getNearbyGroups above, this tier is not distance-
  // ranked at all (there may genuinely be nothing within
  // EXPANDED_NEARBY_RADIUS_KM) - it ranks every other visible, located
  // Section in the caller's own country by a simple, deterministic,
  // "worth knowing about" signal instead (task: "wystarczy stabilny ranking
  // np. memberCount DESC z sensownym secondary sort... nie twórz teraz
  // systemu ML/recommendation engine"). Both still return the exact same
  // NearbySectionCardDto/NearbyGroupCardDto shape as the nearby tier - a
  // real distanceKm is still computed and displayed (the caller's location
  // IS configured by the time this ever runs), it simply is not what this
  // tier sorts by. ────────────────────────────────────────────────────────

  /**
   * discoverySections' COUNTRY tier - every visible (isHidden=false,
   * status=ACTIVE) Section with coordinates in the caller's own country,
   * excluding every Section the caller already belongs to, ranked by active
   * member count desc, then createdAt asc (an older, more established
   * Section breaks a member-count tie ahead of a newer one), then id asc
   * for total determinism.
   */
  async getCountryDiscoverySections(
    userId: string,
    page: PageParams,
  ): Promise<CommunityOverviewBoundedSectionDto<NearbySectionCardDto>> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: userId,
    });
    if (!location) {
      return emptyBoundedSection();
    }

    const mySectionIds = new Set(await this.listMySectionIds(userId));
    const candidates = await this.findCountrySectionCandidates(
      location,
      mySectionIds,
    );

    const total = candidates.length;
    const pageItems = candidates.slice(page.offset, page.offset + page.limit);

    return {
      items: pageItems.map((candidate) =>
        toNearbySectionCardDto(
          candidate.section,
          candidate.distanceKm,
          this.r2StorageService,
        ),
      ),
      total,
      hasMore: page.offset + pageItems.length < total,
    };
  }

  /**
   * discoveryGroups' COUNTRY tier - mirrors getCountryDiscoverySections'
   * own ranking, aggregated per Group exactly the way getNearbyGroups
   * aggregates its own distance-ranked candidates: each Group's "best"
   * Section here is whichever qualifying Section has the highest member
   * count (rather than getNearbyGroups' nearest), reusing the identical
   * NearbyGroupCardDto shape/mapper - `nearestSection`/`distanceKm` still
   * describe that one Section's own real distance,
   * `sectionsCountInRadius` here counts qualifying Sections nationwide, not
   * within a radius. Never includes a Group already in myGroups.
   */
  async getCountryDiscoveryGroups(
    userId: string,
    page: PageParams,
  ): Promise<CommunityOverviewBoundedSectionDto<NearbyGroupCardDto>> {
    const location = await this.em.findOne(UserDiscoveryLocation, {
      user: userId,
    });
    if (!location) {
      return emptyBoundedSection();
    }

    const { relationByGroupId } = await this.resolveMyGroupRelations(userId);
    const mySectionIds = new Set(await this.listMySectionIds(userId));
    const candidates = await this.findCountrySectionCandidates(
      location,
      mySectionIds,
    );

    interface Aggregate {
      group: Group;
      bestSection: Section;
      distanceKm: number;
      memberCount: number;
      sectionsCount: number;
    }
    const byGroupId = new Map<string, Aggregate>();
    for (const candidate of candidates) {
      const group = candidate.section.parentGroup;
      if (!group || relationByGroupId.has(group.id)) {
        continue;
      }
      const existing = byGroupId.get(group.id);
      if (!existing) {
        byGroupId.set(group.id, {
          group,
          bestSection: candidate.section,
          distanceKm: candidate.distanceKm,
          memberCount: candidate.memberCount,
          sectionsCount: 1,
        });
        continue;
      }
      existing.sectionsCount += 1;
      if (candidate.memberCount > existing.memberCount) {
        existing.bestSection = candidate.section;
        existing.distanceKm = candidate.distanceKm;
        existing.memberCount = candidate.memberCount;
      }
    }

    const aggregates = [...byGroupId.values()].sort(
      (a, b) =>
        b.memberCount - a.memberCount ||
        a.bestSection.createdAt.getTime() - b.bestSection.createdAt.getTime() ||
        a.group.id.localeCompare(b.group.id),
    );
    const total = aggregates.length;
    const pageItems = aggregates.slice(page.offset, page.offset + page.limit);

    return {
      items: pageItems.map((aggregate) =>
        toNearbyGroupCardDto(
          aggregate.group,
          aggregate.bestSection,
          aggregate.distanceKm,
          aggregate.sectionsCount,
          this.r2StorageService,
        ),
      ),
      total,
      hasMore: page.offset + pageItems.length < total,
    };
  }

  /**
   * Every visible, located Section in `location.countryCode`, excluding
   * `excludeSectionIds` (the caller's own Sections), with its distance from
   * `location` and its active member count both precomputed - shared by
   * getCountryDiscoverySections and getCountryDiscoveryGroups so the two
   * can never rank the same tier differently. Capped at
   * DISCOVERY_CANDIDATE_SCAN_LIMIT rows, same "cheap, bounded scan" trade-off
   * as findNearbySectionCandidates' own NEARBY_CANDIDATE_SCAN_LIMIT (no
   * bounding box here - there is no radius to pre-filter by in this tier).
   */
  private async findCountrySectionCandidates(
    location: UserDiscoveryLocation,
    excludeSectionIds: Set<string>,
  ): Promise<SectionDiscoveryCandidate[]> {
    const rows = await this.em.find(
      Section,
      {
        country: location.countryCode,
        isHidden: false,
        status: GroupStatus.ACTIVE,
        latitude: { $ne: null },
        longitude: { $ne: null },
      },
      { populate: ['parentGroup'], limit: DISCOVERY_CANDIDATE_SCAN_LIMIT },
    );

    const candidates = rows.filter(
      (section) =>
        !excludeSectionIds.has(section.id) &&
        section.latitude !== null &&
        section.longitude !== null,
    );
    const memberCounts = await this.countActiveMembers(
      candidates.map((section) => section.id),
    );

    const scored = candidates.map((section) => ({
      section,
      distanceKm: haversineKm(
        location.latitude,
        location.longitude,
        section.latitude as number,
        section.longitude as number,
      ),
      memberCount: memberCounts.get(section.id) ?? 0,
    }));

    // Ranked here, once, rather than by each caller separately - the single
    // shared order both getCountryDiscoverySections and
    // getCountryDiscoveryGroups build on (see this method's own class
    // comment on why that matters). memberCount desc first (task: "liczba
    // aktywnych członków"), then createdAt asc (an older, more established
    // Section breaks a tie ahead of a newer one), then id asc for total
    // determinism - never left to whatever order Postgres happened to
    // return rows in.
    scored.sort(
      (a, b) =>
        b.memberCount - a.memberCount ||
        a.section.createdAt.getTime() - b.section.createdAt.getTime() ||
        a.section.id.localeCompare(b.section.id),
    );
    return scored;
  }

  /**
   * ACTIVE/READ_ONLY SectionMembership count per Section id, in one batched
   * query (never one count query per candidate) - the "liczba aktywnych
   * członków" ranking signal getCountryDiscoverySections/
   * getCountryDiscoveryGroups sort by.
   */
  private async countActiveMembers(
    sectionIds: string[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (sectionIds.length === 0) {
      return counts;
    }
    const memberships = await this.em.find(
      SectionMembership,
      {
        section: { $in: sectionIds },
        status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
      },
      { fields: ['section'] },
    );
    for (const membership of memberships) {
      const sectionId = membership.section.id;
      counts.set(sectionId, (counts.get(sectionId) ?? 0) + 1);
    }
    return counts;
  }

  // ─── Shared helpers ──────────────────────────────────────────────────────

  private async listMySectionIds(userId: string): Promise<string[]> {
    const memberships = await this.em.find(
      SectionMembership,
      { user: userId, status: { $in: ACTIVE_MEMBERSHIP_STATUSES } },
      { fields: ['section'] },
    );
    return memberships.map((membership) => membership.section.id);
  }

  /**
   * Every Group id the caller is related to (member-through-Section and/or
   * follower), each mapped to its own independent relation flags - the
   * single shared resolution both getMyGroups() and getNearbyGroups()
   * (for its "never already in myGroups" exclusion) build on, so the two
   * can never disagree about what "mine" means.
   */
  private async resolveMyGroupRelations(userId: string): Promise<{
    relationByGroupId: Map<string, SectionRelationEntry>;
  }> {
    const mySectionIds = await this.listMySectionIds(userId);
    const memberGroupIds = new Set<string>();
    if (mySectionIds.length > 0) {
      const sections = await this.em.find(
        Section,
        { id: { $in: mySectionIds } },
        { populate: ['parentGroup'], fields: ['parentGroup'] },
      );
      for (const section of sections) {
        if (section.parentGroup) {
          memberGroupIds.add(section.parentGroup.id);
        }
      }
    }

    const followedGroupIds = new Set(
      await this.groupFollowService.listFollowedGroupIds(userId),
    );

    const relationByGroupId = new Map<string, SectionRelationEntry>();
    for (const groupId of memberGroupIds) {
      relationByGroupId.set(groupId, {
        isMemberThroughSection: true,
        isFollowing: followedGroupIds.has(groupId),
      });
    }
    for (const groupId of followedGroupIds) {
      if (!relationByGroupId.has(groupId)) {
        relationByGroupId.set(groupId, {
          isMemberThroughSection: false,
          isFollowing: true,
        });
      }
    }

    return { relationByGroupId };
  }

  private resolveRadiusKm(radiusKm: number | undefined): number {
    if (!radiusKm) {
      return DEFAULT_NEARBY_RADIUS_KM;
    }
    return Math.min(radiusKm, MAX_NEARBY_RADIUS_KM);
  }

  /**
   * Every visible (isHidden=false, status=ACTIVE - same convention as
   * DiscoveryService.search) Section with coordinates set, within
   * `radiusKm` of `location`, sorted `distance ASC`. Two-stage: a plain-SQL
   * bounding-box pre-filter (cheap, index-backed, but an over-approximation
   * - see common/geo/distance.ts) capped at NEARBY_CANDIDATE_SCAN_LIMIT
   * rows, then exact haversine scoring/filtering in application code. At
   * very large data volume the scan cap could in principle exclude a
   * genuine match in an extremely dense area before it's ever scored - the
   * acceptable, documented trade-off for "no PostGIS yet" at this
   * project's current scale (see that module's own comment on the upgrade
   * path).
   */
  private async findNearbySectionCandidates(
    location: UserDiscoveryLocation,
    radiusKm: number,
  ): Promise<SectionDistanceCandidate[]> {
    const box = nearbyBoundingBox(
      location.latitude,
      location.longitude,
      radiusKm,
    );
    const rows = await this.em.find(
      Section,
      {
        latitude: { $gte: box.minLatitude, $lte: box.maxLatitude },
        longitude: { $gte: box.minLongitude, $lte: box.maxLongitude },
        isHidden: false,
        status: GroupStatus.ACTIVE,
      },
      { populate: ['parentGroup'], limit: NEARBY_CANDIDATE_SCAN_LIMIT },
    );

    const scored: SectionDistanceCandidate[] = [];
    for (const section of rows) {
      if (section.latitude === null || section.longitude === null) {
        continue;
      }
      const distanceKm = haversineKm(
        location.latitude,
        location.longitude,
        section.latitude,
        section.longitude,
      );
      if (distanceKm <= radiusKm) {
        scored.push({ section, distanceKm });
      }
    }
    scored.sort((a, b) => a.distanceKm - b.distanceKm);
    return scored;
  }
}
