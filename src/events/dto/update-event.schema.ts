import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createEventSchema } from './create-event.schema';

// Full-replace on update, same convention as update-academy.schema.ts.
// `status` is intentionally not part of this schema - it only ever changes
// through the publish/cancel/finish actions (see EventsService).
export const updateEventSchema = createEventSchema;

export class UpdateEventDto extends createZodDto(updateEventSchema) {}

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
