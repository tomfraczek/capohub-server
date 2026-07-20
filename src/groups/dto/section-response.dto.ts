import { SectionStatus } from '../enums/section-status.enum';

export interface SectionResponseDto {
  id: string;
  groupId: string;
  name: string;
  description: string | null;
  status: SectionStatus;
  createdAt: string;
  updatedAt: string;
}
