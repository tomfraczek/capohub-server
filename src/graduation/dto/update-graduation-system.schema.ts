import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { createGraduationSystemSchema } from './create-graduation-system.schema';

// Only the name is editable (see the module spec: "edytować nazwę
// systemu") - isActive has no dedicated write path yet.
export const updateGraduationSystemSchema = createGraduationSystemSchema;

export class UpdateGraduationSystemDto extends createZodDto(
  updateGraduationSystemSchema,
) {}

export type UpdateGraduationSystemInput = z.infer<
  typeof updateGraduationSystemSchema
>;
