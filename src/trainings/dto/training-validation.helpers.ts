import { z } from 'zod';

export const DESCRIPTION_MAX_LENGTH = 5000;
export const TRAINING_PLAN_MAX_LENGTH = 5000;
export const TRAINER_NOTES_MAX_LENGTH = 5000;
export const LOCATION_NAME_MAX_LENGTH = 255;
export const LOCATION_ADDRESS_MAX_LENGTH = 2000;
export const REASON_MAX_LENGTH = 1000;

export const isoDateTimeSchema = z.string().datetime({ offset: true });

// "YYYY-MM-DD" - date-only, matching TrainingSeries.startDate/endDate's
// stored representation (see training-series.entity.ts and
// training-recurrence.util.ts, which treats every series date as a plain
// UTC calendar date).
export const dateOnlySchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format');

// "HH:mm", 24h wall-clock time - TrainingSeries.startTime.
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Must be a time in HH:mm format');

export const nullableCoordinate = (min: number, max: number) =>
  z
    .number()
    .min(min, `Must be at least ${min}`)
    .max(max, `Must be at most ${max}`)
    .nullish()
    .transform((value) => (value === undefined ? null : value));

export const durationMinutesSchema = z
  .number()
  .int()
  .min(1, 'Must be at least 1 minute')
  .max(24 * 60, 'Must be at most 24 hours');

export const dayOfWeekSchema = z
  .number()
  .int()
  .min(0, 'Must be between 0 (Sunday) and 6 (Saturday)')
  .max(6, 'Must be between 0 (Sunday) and 6 (Saturday)');
