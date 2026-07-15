import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';

const MAX_NAME_LENGTH = 100;

// Omitted -> leave the field unchanged. Explicit null or an empty/whitespace
// string -> clear the field. Otherwise -> trimmed, length-bounded value.
const nameFieldSchema = z
  .string()
  .trim()
  .max(MAX_NAME_LENGTH, `Must be at most ${MAX_NAME_LENGTH} characters`)
  .transform((value) => (value.length === 0 ? null : value))
  .nullable()
  .optional();

export const updateUserSchema = z.object({
  firstName: nameFieldSchema,
  lastName: nameFieldSchema,
});

export class UpdateUserDto extends createZodDto(updateUserSchema) {}
