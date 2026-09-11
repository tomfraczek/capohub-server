import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  enumValuesSchema,
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import { maxSeriesEndDate } from '../training-recurrence.util';
import {
  DESCRIPTION_MAX_LENGTH,
  LOCATION_ADDRESS_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  dateOnlySchema,
  dayOfWeekSchema,
  durationMinutesSchema,
  timeOfDaySchema,
} from './training-validation.helpers';

// Weekly recurrence only (see the module spec §1/§19 - no RRULE-style
// language). Every concrete Training in [startDate, endDate] is generated
// eagerly at creation time (see TrainingSeriesService.create) - the
// frontend's 1/3/6/12-month presets are purely a UI affordance that
// resolve to a concrete `endDate` before this schema ever sees them; this
// backend only ever validates the resulting date.
export const createTrainingSeriesSchema = z
  .object({
    dayOfWeek: dayOfWeekSchema,
    startTime: timeOfDaySchema,
    durationMinutes: durationMinutesSchema,
    locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH),
    locationAddress: optionalNullableText(LOCATION_ADDRESS_MAX_LENGTH),
    // Optional - a caller who doesn't pick anyone leaves the series (and
    // every generated occurrence) with no trainer at all (see
    // TrainingSeriesService.create), same reasoning as
    // create-training.schema.ts's own trainerUserId.
    defaultTrainerUserId: uuidSchema.nullish(),
    defaultDescription: optionalNullableText(DESCRIPTION_MAX_LENGTH),
    // Also governs whether a non-member may RSVP - see
    // create-training.schema.ts's identical comment.
    visibility: enumValuesSchema(Object.values(TrainingVisibility)),
    startDate: dateOnlySchema,
    endDate: dateOnlySchema,
  })
  .superRefine((value, ctx) => {
    if (value.endDate < value.startDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'endDate must not be before startDate',
        path: ['endDate'],
      });
    }
    const maxEndDate = maxSeriesEndDate(
      new Date(`${value.startDate}T00:00:00.000Z`),
    )
      .toISOString()
      .slice(0, 10);
    if (value.endDate > maxEndDate) {
      ctx.addIssue({
        code: 'custom',
        message: 'endDate must be at most 3 years after startDate',
        path: ['endDate'],
      });
    }
  });

export class CreateTrainingSeriesDto extends createZodDto(
  createTrainingSeriesSchema,
) {}
export type CreateTrainingSeriesInput = z.infer<
  typeof createTrainingSeriesSchema
>;
