import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createGroupObjectSchema } from './create-group.schema';
import { refineCityIdentification } from './group-validation.helpers';

// Full-replace on update, same convention as update-song.schema.ts and
// update-instrument.schema.ts. `status` is intentionally not part of this
// schema - it only ever changes through POST /groups/:id/archive.
// `.strict()` ensures submitting an unknown field is rejected with 400
// instead of being silently stripped - the caller finds out immediately
// that the field has no effect, rather than assuming it was applied.
//
// Built from createGroupObjectSchema (the pre-`.superRefine` object), not
// createGroupSchema itself - `.strict()` is unavailable once `.superRefine`
// has wrapped it in a ZodEffects. The geonameId/country/city/region
// identification check is reapplied here explicitly, so full-replace
// editing can never save an empty or geonameId-mismatched city any more
// than creation can - and, per this project's legacy-record policy (see
// group.entity.ts), a Group/Section that predates `geonameId` must resolve
// a real one here the next time it is edited, the same as any other edit.
export const updateGroupSchema = createGroupObjectSchema
  .strict()
  .superRefine(refineCityIdentification);

export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
