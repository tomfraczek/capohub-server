import { GroupStatus } from '../enums/group-status.enum';

// A Group is always root-level (parentGroup === null) - see the
// Group/Section rename ADR. No parentGroupId field: a Section's parent is
// exposed on SectionResponseDto instead.
export interface GroupResponseDto {
  id: string;
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
  // ISO 3166-1 alpha-2, optional - a Group may span multiple countries.
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
