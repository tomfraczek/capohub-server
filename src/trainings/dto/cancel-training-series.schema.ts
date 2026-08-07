import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import { REASON_MAX_LENGTH } from './training-validation.helpers';

// Always cancels every future, not-yet-started Training in the series (the
// ALL-scope cancel - see TrainingEditScope's own comment) - a single
// specific occurrence, or "this and following" anchored at one occurrence,
// is cancelled through POST .../trainings/:trainingId/cancel instead (see
// cancel-training.schema.ts).
export const cancelTrainingSeriesSchema = z.object({
  reason: optionalNullableText(REASON_MAX_LENGTH),
});

export class CancelTrainingSeriesDto extends createZodDto(
  cancelTrainingSeriesSchema,
) {}
export type CancelTrainingSeriesInput = z.infer<
  typeof cancelTrainingSeriesSchema
>;
