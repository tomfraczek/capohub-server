import { TrainingRsvp } from '../entities/training-rsvp.entity';
import { TrainingRsvpResponseDto } from '../dto/training-rsvp-response.dto';

export function toTrainingRsvpResponseDto(
  rsvp: TrainingRsvp,
): TrainingRsvpResponseDto {
  return {
    id: rsvp.id,
    trainingId: rsvp.training.id,
    user: {
      id: rsvp.user.id,
      displayName: rsvp.user.displayName,
      gender: rsvp.user.gender,
    },
    status: rsvp.status,
    respondedAt: rsvp.respondedAt.toISOString(),
  };
}
