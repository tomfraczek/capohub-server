import { LearningStatus } from '../enums/learning-status.enum';

export interface LearningStatusResponseDto {
  songId: string;
  status: LearningStatus | null;
}
