import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { enumValuesSchema } from '../../songs/dto/song-validation.helpers';
import { EventCheckInMethod } from '../enums/event-check-in-method.enum';

// The scanned/typed code is always User.publicCode (see
// docs/api/events-api.md "Check-in"). Format-validated the same way a
// Group/User publicCode is (see public-code.ts): "XXXX-XXXX".
export const checkInIdentifySchema = z.object({
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[0-9A-HJ-KM-NP-TV-Z]{4}-[0-9A-HJ-KM-NP-TV-Z]{4}$/,
      'Must be a valid check-in code',
    ),
});

export class CheckInIdentifyDto extends createZodDto(checkInIdentifySchema) {}

export type CheckInIdentifyInput = z.infer<typeof checkInIdentifySchema>;

export const markCheckInSchema = z.object({
  method: enumValuesSchema(Object.values(EventCheckInMethod)),
});

export class MarkCheckInDto extends createZodDto(markCheckInSchema) {}

export type MarkCheckInInput = z.infer<typeof markCheckInSchema>;
