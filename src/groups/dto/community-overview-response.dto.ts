import { GroupStatus } from '../enums/group-status.enum';

// Row shape for "my Sections" (mySections on Home, and GET
// /community/sections/mine) - every Section the caller currently holds an
// active (ACTIVE/READ_ONLY) SectionMembership in. Deliberately lighter than
// the full SectionResponseDto - this backs a carousel/list card, not a
// detail screen (fetch GET /sections/:id for that).
export interface CommunitySectionCardDto {
  id: string;
  name: string;
  logoUrl: string | null;
  parentGroupId: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
  isPublic: boolean;
  isHidden: boolean;
  status: GroupStatus;
}

// A Section card plus its exact distance from the viewer's own discovery
// location (see nearbySections/GET /community/sections/nearby) - km,
// rounded to 1 decimal place for display (see community-overview.mapper.ts).
export interface NearbySectionCardDto extends CommunitySectionCardDto {
  distanceKm: number;
}

// Row shape for "my Groups" (myGroups on Home, and GET
// /community/groups/mine) - every Group the caller is related to either
// through a direct Section membership or an explicit GroupFollow (see
// group-follow.entity.ts), deduplicated to one row per Group id even when
// both are true at once.
export interface CommunityGroupCardDto {
  id: string;
  name: string;
  logoUrl: string | null;
  isPublic: boolean;
  isHidden: boolean;
  status: GroupStatus;
  isMemberThroughSection: boolean;
  isFollowing: boolean;
}

// Row shape for "nearby Groups" (nearbyGroups on Home, and GET
// /community/groups/nearby) - a Group qualifies once it has at least one
// Section within the search radius; `nearestSection`/`distanceKm` describe
// that closest one, and `sectionsCountInRadius` how many of the Group's
// Sections are within the same radius (never just the direct-children
// count SectionResponseDto already exposes). Never overlaps myGroups - see
// CommunityOverviewService.getNearbyGroups.
export interface NearbyGroupCardDto {
  id: string;
  name: string;
  logoUrl: string | null;
  isPublic: boolean;
  isHidden: boolean;
  status: GroupStatus;
  nearestSection: NearbySectionCardDto;
  distanceKm: number;
  sectionsCountInRadius: number;
}

// Shared bounded-section envelope, same shape as
// CommunityHomeBoundedSectionDto (community-home-response.dto.ts) - `total`/
// `hasMore` always describe the full matching set, not just `items`.
export interface CommunityOverviewBoundedSectionDto<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

// GET /community/home's `location` block - `configured: false` means
// mySections/myGroups still work normally, but nearbySections/nearbyGroups
// are always empty (module: "Jeżeli użytkownik nie ma ustawionej lokalizacji
// ... DTO musi jasno informować location.configured = false"). Deliberately
// city/region/countryCode only, no latitude/longitude - the raw coordinates
// are exposed via GET /users/me/discovery-location, not repeated here.
export interface CommunityLocationSummaryDto {
  configured: boolean;
  city?: string;
  region?: string;
  countryCode?: string;
}

// Home's discovery-fallback tag (see CommunityHomeService.getHome and this
// feature's own report, "Community Home nie może być pusty"):
//  - 'NONE': either the caller's own DEFAULT_NEARBY_RADIUS_KM search already
//    returned something, or no discovery location is configured at all
//    (location.configured === false already gets its own CTA - discovery
//    fallback never duplicates that). discoverySections/discoveryGroups are
//    always empty here.
//  - 'EXPANDED_RADIUS': nearbySections and nearbyGroups were BOTH empty at
//    DEFAULT_NEARBY_RADIUS_KM, but retrying at EXPANDED_NEARBY_RADIUS_KM
//    found at least one Section or Group - discoverySections/
//    discoveryGroups hold that wider-radius result (never merged into
//    nearbySections/nearbyGroups themselves, so the frontend can never
//    mislabel a 120km result as "w pobliżu").
//  - 'COUNTRY': the expanded radius ALSO came back empty - discoverySections/
//    discoveryGroups instead hold the deterministic, country-wide ranking
//    (see CommunityOverviewService.getCountryDiscoverySections).
export type DiscoveryFallbackType = 'NONE' | 'EXPANDED_RADIUS' | 'COUNTRY';

export interface CommunityDiscoveryContextDto {
  nearbyRadiusKm: number;
  expandedRadiusKm: number;
  fallbackType: DiscoveryFallbackType;
}
