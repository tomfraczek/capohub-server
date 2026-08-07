import { z } from 'zod';
import {
  enumValuesSchema,
  optionalNullableText,
  uuidSchema,
} from '../../songs/dto/song-validation.helpers';
import { TrainingEditScope } from '../enums/training-edit-scope.enum';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import {
  DESCRIPTION_MAX_LENGTH,
  LOCATION_ADDRESS_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  durationMinutesSchema,
  isoDateTimeSchema,
  nullableCoordinate,
  timeOfDaySchema,
} from './training-validation.helpers';

// scope: THIS - a full, arbitrary override of this single Training only
// (see the module spec §8). May move it to any date/time - it is
// deliberately not required to stay consistent with its TrainingSeries'
// recurrence rule (this row is the source of truth for its own date).
const updateTrainingThisSchema = z
  .object({
    scope: z.literal(TrainingEditScope.THIS),
    startsAt: isoDateTimeSchema.optional(),
    endsAt: isoDateTimeSchema.optional(),
    locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH).optional(),
    locationAddress: optionalNullableText(
      LOCATION_ADDRESS_MAX_LENGTH,
    ).optional(),
    latitude: nullableCoordinate(-90, 90).optional(),
    longitude: nullableCoordinate(-180, 180).optional(),
    trainerUserId: uuidSchema.optional(),
    description: optionalNullableText(DESCRIPTION_MAX_LENGTH).optional(),
    visibility: enumValuesSchema(Object.values(TrainingVisibility)).optional(),
    allowExternalRsvp: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    if (value.startsAt === undefined && value.endsAt === undefined) {
      return;
    }
    if (value.startsAt === undefined || value.endsAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        message: 'startsAt and endsAt must be provided together',
        path: ['endsAt'],
      });
      return;
    }
    if (
      new Date(value.endsAt).getTime() <= new Date(value.startsAt).getTime()
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'endsAt must be after startsAt',
        path: ['endsAt'],
      });
    }
  });

// scope: THIS_AND_FOLLOWING - applies to this Training and every future,
// not-yet-started Training in the same series from its startsAt onward
// (see TrainingEditScope). `startTime`/`durationMinutes` are combined with
// each affected Training's own existing calendar date (never a new date -
// changing which weekday a series runs on is an ALL-scope, series-level
// change - see update-training-series.schema.ts).
const updateTrainingThisAndFollowingSchema = z.object({
  scope: z.literal(TrainingEditScope.THIS_AND_FOLLOWING),
  startTime: timeOfDaySchema.optional(),
  durationMinutes: durationMinutesSchema.optional(),
  locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH).optional(),
  locationAddress: optionalNullableText(LOCATION_ADDRESS_MAX_LENGTH).optional(),
  latitude: nullableCoordinate(-90, 90).optional(),
  longitude: nullableCoordinate(-180, 180).optional(),
  trainerUserId: uuidSchema.optional(),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH).optional(),
  visibility: enumValuesSchema(Object.values(TrainingVisibility)).optional(),
  allowExternalRsvp: z.boolean().optional(),
});

export const updateTrainingSchema = z.discriminatedUnion('scope', [
  updateTrainingThisSchema,
  updateTrainingThisAndFollowingSchema,
]);

// Deliberately not a createZodDto(...) class - z.infer of a discriminated
// union is a union type, which cannot be a class's base constructor return
// type (TS2509). Only the ZodValidationPipe + this exported type are
// needed; nothing in this codebase reflects on the DTO class itself (no
// Swagger/OpenAPI - see docs/api-conventions.md).
export type UpdateTrainingInput = z.infer<typeof updateTrainingSchema>;
