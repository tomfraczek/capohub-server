import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createSectionSchema } from './create-section.schema';

// Full-replace on update, same convention as update-group.schema.ts.
// `status` is intentionally not part of this schema - it only ever changes
// through the archive endpoint.
export const updateSectionSchema = createSectionSchema;

export class UpdateSectionDto extends createZodDto(updateSectionSchema) {}

export type UpdateSectionInput = z.infer<typeof updateSectionSchema>;
