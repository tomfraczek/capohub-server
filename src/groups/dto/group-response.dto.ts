import { GroupStatus } from '../enums/group-status.enum';

// Group is a physically distinct entity type (see the Group/Section
// physical-split ADR, stage 1) - `parentGroupId` reflects its actual
// position in the hierarchy (null for a root Group), never a way to guess
// *what kind* of row this is; every row returned through this DTO is
// already known to be a Group.
export interface GroupResponseDto {
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
  // Direct child Groups only (one level down) - not recursive.
  childGroupsCount: number;
  // Direct Sections only (one level down) - not recursive.
  directSectionsCount: number;
  createdAt: string;
  updatedAt: string;
}
