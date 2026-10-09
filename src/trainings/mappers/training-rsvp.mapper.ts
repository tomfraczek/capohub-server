import { TrainingRsvp } from '../entities/training-rsvp.entity';
import { TrainingRsvpResponseDto } from '../dto/training-rsvp-response.dto';
import { resolveDisplayName } from '../../users/display-name.util';

export function toTrainingRsvpResponseDto(
  rsvp: TrainingRsvp,
): TrainingRsvpResponseDto {
  return {
    id: rsvp.id,
    trainingId: rsvp.training.id,
    user: {
      id: rsvp.user.id,
      displayName: resolveDisplayName(rsvp.user),
      gender: rsvp.user.gender,
    },
    status: rsvp.status,
    respondedAt: rsvp.respondedAt.toISOString(),
  };
}
