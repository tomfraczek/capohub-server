import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { integerQueryParam } from '../../common/validation/query.schemas';

// GET /discovery/places?search=&limit= - see place-search-result.dto.ts.
// `search` has no default/optional form (unlike citySearchQuerySchema's
// `search`) - this endpoint has no "browse everything" mode at all (there
// is no `country` to scope an unfiltered request by), so a real query is
// always required. A 2-character floor keeps a global, all-countries scan
// from returning an enormous, useless result set on a single keystroke.
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 20;

export const placeSearchQuerySchema = z.object({
  search: z.string().trim().min(2).max(100),
  limit: integerQueryParam(z.number().int().positive().max(MAX_LIMIT)).default(
    DEFAULT_LIMIT,
  ),
});

export class PlaceSearchQueryDto extends createZodDto(
  placeSearchQuerySchema,
) {}

export type PlaceSearchQuery = z.infer<typeof placeSearchQuerySchema>;
