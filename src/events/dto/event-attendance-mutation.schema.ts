import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

// PUT events/:eventId/attendance/:userId - a direct, organizer-addressed
// toggle (same shape as Training's recordTrainingAttendanceSchema, kept
// consistent on purpose).
export const recordEventAttendanceSchema = z.object({
  attended: z.boolean(),
});

export class RecordEventAttendanceDto extends createZodDto(
  recordEventAttendanceSchema,
) {}
export type RecordEventAttendanceInput = z.infer<
  typeof recordEventAttendanceSchema
>;

// POST events/:eventId/check-in AND POST events/:eventId/attendance/identify
// - both take exactly this one field, the resolver itself disambiguating a
// numeric code from a QR payload (module spec §8: "Jeżeli repo preferuje
// jeden input: identity" - the same shape Training's check-in endpoint
// uses too, so every identity-taking endpoint shares one request contract).
export const eventCheckInSchema = z.object({
  identity: z.string().trim().min(1),
});

export class EventCheckInDto extends createZodDto(eventCheckInSchema) {}
export type EventCheckInInput = z.infer<typeof eventCheckInSchema>;
