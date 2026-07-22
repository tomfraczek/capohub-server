import { GroupStatus } from '../enums/group-status.enum';

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
  createdAt: string;
  updatedAt: string;
}
