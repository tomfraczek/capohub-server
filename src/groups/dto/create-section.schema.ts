import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';

const DESCRIPTION_MAX_LENGTH = 5000;

export const createSectionSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
});

export class CreateSectionDto extends createZodDto(createSectionSchema) {}

export type CreateSectionInput = z.infer<typeof createSectionSchema>;
