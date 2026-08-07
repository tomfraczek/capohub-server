import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';
import { TrainingUserRefDto } from './training-user-ref.dto';

export interface TrainingRsvpResponseDto {
  id: string;
  trainingId: string;
  user: TrainingUserRefDto;
  status: TrainingRsvpStatus;
  respondedAt: string;
}
