import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createSectionSchema } from './create-section.schema';

// Full-replace on update, same convention as update-group.schema.ts.
// `status` is intentionally not part of this schema - it only ever changes
// through the archive/unarchive/read-only/activate endpoints. The parent
// (which Group or Section this Section is nested under) is immutable after
// creation, same as parentGroupId used to be on Group.
export const updateSectionSchema = createSectionSchema.strict();

export class UpdateSectionDto extends createZodDto(updateSectionSchema) {}

export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
