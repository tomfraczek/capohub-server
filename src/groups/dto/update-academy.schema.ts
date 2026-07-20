import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createAcademySchema } from './create-academy.schema';

// Full-replace on update, same convention as update-group.schema.ts.
// `status` is intentionally not part of this schema - it only ever changes
// through the archive endpoint.
export const updateAcademySchema = createAcademySchema;

export class UpdateAcademyDto extends createZodDto(updateAcademySchema) {}

export type UpdateAcademyInput = z.infer<typeof updateAcademySchema>;
