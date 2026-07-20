import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createGroupSchema } from './create-group.schema';

// Full-replace on update, same convention as update-song.schema.ts and
// update-instrument.schema.ts. `status` is intentionally not part of this
// schema - it only ever changes through POST /groups/:id/archive.
// `parentGroupId` is also excluded - it is immutable after creation, and
// there is no operation (not even through GroupHierarchyService) that
// changes it, so a plain field update must never be able to touch it
// either (see organization-entities.md#validation-rules). `.strict()`
// ensures submitting it (or any other unknown field) is rejected with 400
// instead of being silently stripped - the caller finds out immediately
// that the field has no effect, rather than assuming it was applied.
export const updateGroupSchema = createGroupSchema
  .omit({ parentGroupId: true })
  .strict();

export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
