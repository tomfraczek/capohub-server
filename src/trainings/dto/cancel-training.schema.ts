import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  enumValuesSchema,
  optionalNullableText,
} from '../../songs/dto/song-validation.helpers';
import { TrainingEditScope } from '../enums/training-edit-scope.enum';
import { REASON_MAX_LENGTH } from './training-validation.helpers';

// scope: THIS cancels only the addressed Training; THIS_AND_FOLLOWING also
// cancels every future, not-yet-started Training in the same series from
// its startsAt onward (see the module spec §9 and TrainingEditScope). A
// Training with no series can only ever be cancelled with scope THIS - see
// TrainingsService.cancel.
export const cancelTrainingSchema = z.object({
  scope: enumValuesSchema(Object.values(TrainingEditScope)),
  reason: optionalNullableText(REASON_MAX_LENGTH),
});

export class CancelTrainingDto extends createZodDto(cancelTrainingSchema) {}
export type CancelTrainingInput = z.infer<typeof cancelTrainingSchema>;
