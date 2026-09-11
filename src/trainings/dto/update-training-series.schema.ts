import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  enumValuesSchema,
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import {
  DESCRIPTION_MAX_LENGTH,
  LOCATION_ADDRESS_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  dateOnlySchema,
  dayOfWeekSchema,
  durationMinutesSchema,
  timeOfDaySchema,
} from './training-validation.helpers';

// Always an ALL-scope change (see TrainingEditScope's own comment): every
// provided field replaces the series' own default, and cascades to every
// future, not-yet-started Training in the series (see
// TrainingSeriesService.update). `endDate` may only be extended, never
// pulled before any already-generated future Training - shortening a
// series is done via POST .../cancel instead (see
// cancel-training-series.schema.ts).
export const updateTrainingSeriesSchema = z.object({
  dayOfWeek: dayOfWeekSchema.optional(),
  startTime: timeOfDaySchema.optional(),
  durationMinutes: durationMinutesSchema.optional(),
  locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH).optional(),
  locationAddress: optionalNullableText(LOCATION_ADDRESS_MAX_LENGTH).optional(),
  defaultTrainerUserId: uuidSchema.optional(),
  defaultDescription: optionalNullableText(DESCRIPTION_MAX_LENGTH).optional(),
  visibility: enumValuesSchema(Object.values(TrainingVisibility)).optional(),
  endDate: dateOnlySchema.optional(),
});

export class UpdateTrainingSeriesDto extends createZodDto(
  updateTrainingSeriesSchema,
) {}
export type UpdateTrainingSeriesInput = z.infer<
  typeof updateTrainingSeriesSchema
>;
