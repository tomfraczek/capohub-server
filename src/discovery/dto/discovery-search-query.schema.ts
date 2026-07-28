import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { optionalTrimmedStringQuerySchema } from '../../common/validation/query.schemas';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';

export const COMMUNITY_SEARCH_TYPE_VALUES = ['GROUP', 'SECTION'] as const;

// Every filter is optional on its own, but the endpoint must never resolve
// to "return everything" - see docs/api-conventions.md and the Group/Section
// rename ADR's "Discover Community" section. `type` alone does not satisfy
// this: it narrows an existing name/country/city search, it is not a search
// criterion by itself (there is no bounded "list every Section" use case).
// A failed .refine() surfaces through ZodValidationPipe as the same generic
// { code: 'VALIDATION_ERROR', errors: [...] } shape as every other
// validation failure in this codebase - no bespoke error code, by design.
export const discoverySearchQuerySchema = paginationQuerySchema
  .extend({
    name: optionalTrimmedStringQuerySchema,
    country: z
      .string()
      .trim()
      .toUpperCase()
      .refine(
        isValidIsoCountryCode,
        'Must be a valid ISO 3166-1 alpha-2 country code',
      )
      .optional(),
    city: optionalTrimmedStringQuerySchema,
    type: z.enum(COMMUNITY_SEARCH_TYPE_VALUES).optional(),
  })
  .refine((query) => Boolean(query.name || query.country || query.city), {
    message:
      'At least one of name, country, or city is required to search - type alone is not enough',
    path: ['name'],
  });

export class DiscoverySearchQueryDto extends createZodDto(
  discoverySearchQuerySchema,
) {}

export type DiscoverySearchQuery = z.infer<typeof discoverySearchQuerySchema>;
