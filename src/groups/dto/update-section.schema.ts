import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createSectionObjectSchema } from './create-section.schema';
import { refineCityMatchesCountry } from './group-validation.helpers';

// Full-replace on update, same convention as update-group.schema.ts.
// `status` is intentionally not part of this schema - it only ever changes
// through the archive/unarchive/read-only/activate endpoints. The parent
// (which Group or Section this Section is nested under) is immutable after
// creation, same as parentGroupId used to be on Group.
//
// Built from createSectionObjectSchema, then `.strict()`'d and re-refined,
// for the same reason as update-group.schema.ts - see its comment.
export const updateSectionSchema = createSectionObjectSchema
  .strict()
  .superRefine(refineCityMatchesCountry);

export class UpdateSectionDto extends createZodDto(updateSectionSchema) {}

export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
