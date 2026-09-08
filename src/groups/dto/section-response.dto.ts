import { GroupStatus } from '../enums/group-status.enum';

// Section is a physically distinct entity type (see the Group/Section
// physical-split ADR, stage 1) - `parentGroupId` is null for a standalone
// Section (no parent yet) and otherwise always references a Group (never
// another Section - a Section can never be another Section's parent).
export interface SectionResponseDto {
  id: string;
  parentGroupId: string | null;
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
  country: string | null;
  city: string | null;
  region: string | null;
  geonameId: number | null;
  latitude: number | null;
  longitude: number | null;
  createdAt: string;
  updatedAt: string;
}
