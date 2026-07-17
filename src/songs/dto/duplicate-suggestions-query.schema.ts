import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { integerQueryParam } from '../../common/validation/query.schemas';

// Matches Song.title's max length (see create-song.schema.ts's titleSchema).
const TITLE_MAX_LENGTH = 200;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;

export const duplicateSuggestionsQuerySchema = z.object({
  // No .min(1): an empty or very short title is valid input that yields an
  // empty `items` list (spec section 2), not a validation error. The
  // `title` key itself is still required - a missing param fails schema
  // validation with a 400, same as any other required field.
  title: z.string().trim().max(TITLE_MAX_LENGTH),
  limit: integerQueryParam(z.number().int().min(1).max(MAX_LIMIT)).default(
    DEFAULT_LIMIT,
  ),
});

export class DuplicateSuggestionsQueryDto extends createZodDto(
  duplicateSuggestionsQuerySchema,
) {}

export type DuplicateSuggestionsQuery = z.infer<
  typeof duplicateSuggestionsQuerySchema
>;
