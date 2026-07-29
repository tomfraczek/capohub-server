import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { integerQueryParam } from '../../common/validation/query.schemas';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';

// Smaller than the general search/list default (20/100 - see
// discovery-search-query.schema.ts, event-list-query.schema.ts) on purpose:
// this backs a typeahead city picker, not a browsable list - a caller
// narrows further by typing more of `search` rather than paging through
// results.
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;

// `country` is required (unlike discovery-search-query.schema.ts's optional
// filters) - this endpoint answers "which cities does this one country
// have", never "list cities across every country". `search` is optional and
// narrows by name (case-insensitive substring, see CitySearchService).
export const citySearchQuerySchema = z.object({
  country: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      isValidIsoCountryCode,
      'Must be a valid ISO 3166-1 alpha-2 country code',
    ),
  search: z.string().trim().min(1).max(100).optional(),
  limit: integerQueryParam(z.number().int().positive().max(MAX_LIMIT)).default(
    DEFAULT_LIMIT,
  ),
});

export class CitySearchQueryDto extends createZodDto(citySearchQuerySchema) {}

export type CitySearchQuery = z.infer<typeof citySearchQuerySchema>;
