import {
  PublicUrlBuilder,
  resolveImageUrl,
} from '../../storage/image-url.util';
import { Section } from '../entities/section.entity';
import { Group } from '../entities/group.entity';
import {
  CommunityGroupCardDto,
  CommunitySectionCardDto,
  NearbyGroupCardDto,
  NearbySectionCardDto,
} from '../dto/community-overview-response.dto';

// Distance is rounded to 1 decimal place for display - the exact haversine
// value (see common/geo/distance.ts) is still what nearby ranking/radius
// filtering uses internally; only the *rendered* number is rounded, so a UI
// never shows more precision than it can usefully act on.
function roundDistanceKm(distanceKm: number): number {
  return Math.round(distanceKm * 10) / 10;
}

export function toCommunitySectionCardDto(
  section: Section,
  urlBuilder: PublicUrlBuilder,
): CommunitySectionCardDto {
  return {
    id: section.id,
    name: section.name,
    logoUrl: resolveImageUrl(
      section.profileImageKey,
      section.logoUrl,
      urlBuilder,
    ),
    parentGroupId: section.parentGroup?.id ?? null,
    city: section.city,
    region: section.region,
    country: section.country,
    isPublic: section.isPublic,
    isHidden: section.isHidden,
    status: section.status,
  };
}

export function toNearbySectionCardDto(
  section: Section,
  distanceKm: number,
  urlBuilder: PublicUrlBuilder,
): NearbySectionCardDto {
  return {
    ...toCommunitySectionCardDto(section, urlBuilder),
    distanceKm: roundDistanceKm(distanceKm),
  };
}

export function toCommunityGroupCardDto(
  group: Group,
  relation: {
    isFormalGroup: boolean;
    isMemberThroughSection: boolean;
    isFollowing: boolean;
  },
  urlBuilder: PublicUrlBuilder,
): CommunityGroupCardDto {
  return {
    id: group.id,
    name: group.name,
    logoUrl: resolveImageUrl(group.profileImageKey, group.logoUrl, urlBuilder),
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    status: group.status,
    isFormalGroup: relation.isFormalGroup,
    isMemberThroughSection: relation.isMemberThroughSection,
    isFollowing: relation.isFollowing,
  };
}

export function toNearbyGroupCardDto(
  group: Group,
  nearestSection: Section,
  distanceKm: number,
  sectionsCountInRadius: number,
  urlBuilder: PublicUrlBuilder,
): NearbyGroupCardDto {
  return {
    id: group.id,
    name: group.name,
    logoUrl: resolveImageUrl(group.profileImageKey, group.logoUrl, urlBuilder),
    isPublic: group.isPublic,
    isHidden: group.isHidden,
    status: group.status,
    nearestSection: toNearbySectionCardDto(
      nearestSection,
      distanceKm,
      urlBuilder,
    ),
    distanceKm: roundDistanceKm(distanceKm),
    sectionsCountInRadius,
  };
}
