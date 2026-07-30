import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createRecipientGroupSchema } from './create-recipient-group.schema';

// Full-replace on update (name + the complete member list), same
// convention as update-cohort.schema.ts. `isActive` is intentionally not
// part of this schema - it only ever changes through the
// activate/deactivate endpoints.
export const updateRecipientGroupSchema = createRecipientGroupSchema;

export class UpdateRecipientGroupDto extends createZodDto(
  updateRecipientGroupSchema,
) {}

export type UpdateRecipientGroupInput = z.infer<
  typeof updateRecipientGroupSchema
>;
