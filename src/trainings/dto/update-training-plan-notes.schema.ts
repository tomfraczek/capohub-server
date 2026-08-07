import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import {
  TRAINER_NOTES_MAX_LENGTH,
  TRAINING_PLAN_MAX_LENGTH,
} from './training-validation.helpers';

// Deliberately its own endpoint/schema, separate from
// update-training.schema.ts - see the module spec §13: these two fields are
// reachable by a Training's assigned trainer even when they hold none of
// the Section-wide permissions update-training.schema.ts's PATCH requires
// (see TrainingsController and TrainingAccessService).
export const updateTrainingPlanNotesSchema = z.object({
  trainingPlan: optionalNullableText(TRAINING_PLAN_MAX_LENGTH).optional(),
  trainerNotes: optionalNullableText(TRAINER_NOTES_MAX_LENGTH).optional(),
});

export class UpdateTrainingPlanNotesDto extends createZodDto(
  updateTrainingPlanNotesSchema,
) {}
export type UpdateTrainingPlanNotesInput = z.infer<
  typeof updateTrainingPlanNotesSchema
>;
