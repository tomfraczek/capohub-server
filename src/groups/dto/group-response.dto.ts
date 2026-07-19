import { GroupStatus } from '../enums/group-status.enum';
import { GroupVisibility } from '../enums/group-visibility.enum';

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
  visibility: GroupVisibility;
  status: GroupStatus;
  timezone: string;
  currencyCode: string;
  createdAt: string;
  updatedAt: string;
}
