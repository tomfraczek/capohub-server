import { CohortStatus } from '../enums/cohort-status.enum';

export interface CohortResponseDto {
  id: string;
  groupId: string;
  name: string;
  description: string | null;
  status: CohortStatus;
  createdAt: string;
  updatedAt: string;
}
