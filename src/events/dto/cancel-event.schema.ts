import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { REASON_MAX_LENGTH } from './event-validation.helpers';

export const cancelEventSchema = z.object({
  reason: z
    .string()
    .trim()
    .min(1)
    .max(REASON_MAX_LENGTH)
    .nullish()
    .transform((value) => (value ? value : null)),
});

export class CancelEventDto extends createZodDto(cancelEventSchema) {}

export type CancelEventInput = z.infer<typeof cancelEventSchema>;
