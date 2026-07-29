import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createGroupObjectSchema } from './create-group.schema';
import { refineCityMatchesCountry } from './group-validation.helpers';

// Full-replace on update, same convention as update-song.schema.ts and
// update-instrument.schema.ts. `status` is intentionally not part of this
// schema - it only ever changes through POST /groups/:id/archive.
// `.strict()` ensures submitting an unknown field is rejected with 400
// instead of being silently stripped - the caller finds out immediately
// that the field has no effect, rather than assuming it was applied.
//
// Built from createGroupObjectSchema (the pre-`.superRefine` object), not
// createGroupSchema itself - `.strict()` is unavailable once `.superRefine`
// has wrapped it in a ZodEffects. The country<->city cross-check is
// reapplied here explicitly, so full-replace editing can never save an
// empty or country-mismatched city any more than creation can.
export const updateGroupSchema = createGroupObjectSchema
  .strict()
  .superRefine(refineCityMatchesCountry);

export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
