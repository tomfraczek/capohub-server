import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { TrainingRsvpStatus } from '../enums/training-rsvp-status.enum';

export const updateTrainingRsvpSchema = z.object({
  status: enumValuesSchema(Object.values(TrainingRsvpStatus)),
});

export class UpdateTrainingRsvpDto extends createZodDto(
  updateTrainingRsvpSchema,
) {}
export type UpdateTrainingRsvpInput = z.infer<typeof updateTrainingRsvpSchema>;
