import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createGroupObjectSchema } from './create-group.schema';

// Full-replace on update, same convention as update-song.schema.ts and
// update-instrument.schema.ts. `status` is intentionally not part of this
// schema - it only ever changes through POST /groups/:id/archive.
// `.strict()` ensures submitting an unknown field is rejected with 400
// instead of being silently stripped - the caller finds out immediately
// that the field has no effect, rather than assuming it was applied.
export const updateGroupSchema = createGroupObjectSchema.strict();

export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
