import { GroupStatus } from '../enums/group-status.enum';

// A Section is a non-root Group (see the Group/Section rename ADR) - same
// underlying entity/table as Group, hence the near-identical field set to
// GroupResponseDto, but exposed under its own route family
// (/sections/:sectionId) with `parentId` instead of the (removed)
// parentGroupId. `parentId` may itself be a Group or another Section, since
// nesting is unlimited-depth (ADR-002) - the caller cannot tell which from
// this id alone.
export interface SectionResponseDto {
  id: string;
  parentId: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  isPublic: boolean;
  isHidden: boolean;
  memberInvitesAllowed: boolean;
  publicCode: string | null;
  status: GroupStatus;
  timezone: string;
  currencyCode: string;
  // ISO 3166-1 alpha-2 - required on create for every Section (see
  // create-section.schema.ts), so always non-null in practice. Typed as
  // nullable anyway since it is the same physical column as Group.country
  // (which is genuinely optional) - see the Group/Section rename ADR.
  country: string | null;
  city: string | null;
  // The admin1 region name - display/compatibility only, see `city`.
  region: string | null;
  // The GeoNames identifier this location resolves to - the source of
  // truth `country`/`city`/`region` are cross-checked against (see
  // group-validation.helpers.ts#refineCityIdentification). `null` only on
  // a legacy row created before this field existed - see group.entity.ts.
  geonameId: number | null;
  createdAt: string;
  updatedAt: string;
}
