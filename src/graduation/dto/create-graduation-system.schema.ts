import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

export const createGraduationSystemSchema = z.object({
  name: z.string().trim().min(1, 'Must not be empty').max(150),
});

export class CreateGraduationSystemDto extends createZodDto(
  createGraduationSystemSchema,
) {}

export type CreateGraduationSystemInput = z.infer<
  typeof createGraduationSystemSchema
>;
