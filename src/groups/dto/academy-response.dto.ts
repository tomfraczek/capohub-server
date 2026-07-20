import { AcademyStatus } from '../enums/academy-status.enum';

export interface AcademyResponseDto {
  id: string;
  groupId: string;
  name: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  contactEmail: string | null;
  contactPhone: string | null;
  openingHours: string | null;
  photoUrls: string[] | null;
  description: string | null;
  status: AcademyStatus;
  createdAt: string;
  updatedAt: string;
}
