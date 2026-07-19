import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createGroupSchema } from './create-group.schema';

// Full-replace on update, same convention as update-song.schema.ts and
// update-instrument.schema.ts. `status` is intentionally not part of this
// schema - it only ever changes through POST /groups/:id/archive.
export const updateGroupSchema = createGroupSchema;

export class UpdateGroupDto extends createZodDto(updateGroupSchema) {}

export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
