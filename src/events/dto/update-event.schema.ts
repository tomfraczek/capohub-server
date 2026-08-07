import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  eventBaseSchema,
  refineEventDateAndWaitlist,
} from './create-event.schema';

// Full-replace update of every *editable* field, same convention as
// update-academy.schema.ts - but unlike a plain PartialType/OmitType of
// createEventSchema, `type` and `customTypeLabel` are structurally absent
// here, not merely optional: an Event's kind is immutable once created
// (see event.entity.ts and EventsService.update, which never assigns
// either field). A client cannot change the type by sending it - the field
// doesn't exist in this schema, so Zod strips/rejects it before the
// service ever sees it. `status` is intentionally not part of this schema
// either - it only ever changes through the publish/cancel/finish actions
// (see EventsService).
export const updateEventSchema = eventBaseSchema
  .omit({ type: true, customTypeLabel: true })
  .superRefine(refineEventDateAndWaitlist);

export class UpdateEventDto extends createZodDto(updateEventSchema) {}

export type UpdateEventInput = z.infer<typeof updateEventSchema>;
