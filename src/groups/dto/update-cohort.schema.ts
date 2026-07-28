import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createCohortSchema } from './create-cohort.schema';

// Full-replace on update, same convention as update-group.schema.ts.
// `status` is intentionally not part of this schema - it only ever changes
// through the archive endpoint.
export const updateCohortSchema = createCohortSchema;

export class UpdateCohortDto extends createZodDto(updateCohortSchema) {}

export type UpdateCohortInput = z.infer<typeof updateCohortSchema>;
