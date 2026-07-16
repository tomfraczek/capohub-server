import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import {
  integerQueryParam,
  optionalTrimmedStringQuerySchema,
} from '../../common/validation/query.schemas';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const tagsQuerySchema = z.object({
  search: optionalTrimmedStringQuerySchema,
  limit: integerQueryParam(z.number().int().positive().max(MAX_LIMIT)).default(
    DEFAULT_LIMIT,
  ),
});

export class TagsQueryDto extends createZodDto(tagsQuerySchema) {}

export type TagsQuery = z.infer<typeof tagsQuerySchema>;
