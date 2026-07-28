import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { optionalNullableText } from '../../songs/dto/song-validation.helpers';

const DESCRIPTION_MAX_LENGTH = 5000;

export const createCohortSchema = z.object({
  name: z.string().trim().min(1).max(150),
  description: optionalNullableText(DESCRIPTION_MAX_LENGTH),
});

export class CreateCohortDto extends createZodDto(createCohortSchema) {}

export type CreateCohortInput = z.infer<typeof createCohortSchema>;
