import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';
import { uuidSchema } from '../../common/validation/uuid.schema';
import { TrainingVisibility } from '../enums/training-visibility.enum';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import {
  DESCRIPTION_MAX_LENGTH,
  LOCATION_ADDRESS_MAX_LENGTH,
  LOCATION_NAME_MAX_LENGTH,
  isoDateTimeSchema,
} from './training-validation.helpers';

// A one-off Training - no TrainingSeries involved (see the module spec
// §10). A recurring Training is created via
// POST /sections/:sectionId/training-series instead (see
// create-training-series.schema.ts) - the two create flows are
// deliberately separate endpoints, not one discriminated-union body,
// mirroring the API surface listed in the module spec §18.
export const createTrainingSchema = z
  .object({
    startsAt: isoDateTimeSchema,
    endsAt: isoDateTimeSchema,
    locationName: optionalNullableText(LOCATION_NAME_MAX_LENGTH),
    locationAddress: optionalNullableText(LOCATION_ADDRESS_MAX_LENGTH),
    // Optional - a caller who doesn't pick anyone leaves the Training with
    // no trainer at all (see TrainingsService.create), never defaulted to
    // the caller (module: "wybór prowadzącego powinien być opcjonalny").
    trainerUserId: uuidSchema.nullish(),
    description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
    // Also governs whether a non-member may RSVP - PUBLIC alone is
    // sufficient, no separate opt-in (module: "skoro publiczna to mogą się
    // zapisywać osoby spoza sekcji" - see TrainingAccessService.canRsvp).
    visibility: enumValuesSchema(Object.values(TrainingVisibility)),
  })
  .superRefine((value, ctx) => {
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

export class CreateTrainingDto extends createZodDto(createTrainingSchema) {}
export type CreateTrainingInput = z.infer<typeof createTrainingSchema>;
