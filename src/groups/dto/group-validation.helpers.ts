import { z } from 'zod';
import { isKnownCity } from '../../common/geo/city-directory';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';

// IANA time zone database is the runtime's own source of truth - no
// hand-maintained list to fall out of date.
const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

// ISO 3166-1 alpha-2 only (e.g. "PL", "DE", "BR") - never a free-text
// country name. Uppercased before checking so "pl"/"Pl" are accepted and
// normalized, matching currencyCodeSchema's convention below. Required on
// both Group and Section (business rule: every newly created or edited
// Group/Section must have a country and a city - see create-group.schema.ts/
// create-section.schema.ts, both full-replace on update too).
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    isValidIsoCountryCode,
    'Must be a valid ISO 3166-1 alpha-2 country code',
  );

// Free text, but constrained to a real city of the eventually-chosen
// country - see refineCityMatchesCountry below, which does the actual
// country-aware check (this schema alone has no access to the sibling
// `country` field). Required on both Group and Section, same as
// countryCodeSchema - an empty/missing value is rejected, never silently
// normalized to null (unlike the other optional free-text fields on this
// aggregate, e.g. description).
export const citySchema = z.string().trim().min(1).max(100);

/**
 * Cross-field check for a Zod object shaped `{ country, city }` (both
 * already validated individually by countryCodeSchema/citySchema) -
 * confirms `city` is actually a real city of `country`, using the same
 * dataset the city-search endpoint itself is built on (see
 * common/geo/city-directory.ts and discovery/city-search.service.ts) so the
 * two can never drift ("only accept a city you could also have found
 * through search"). Attach via `.superRefine(refineCityMatchesCountry)` -
 * `.refine()` cannot express two dependent fields with one error `path`.
 */
export function refineCityMatchesCountry(
  data: { country: string; city: string },
  ctx: z.RefinementCtx,
): void {
  if (!isKnownCity(data.country, data.city)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'city must be a real city of the given country (see GET /discovery/cities)',
      path: ['city'],
    });
  }
}

export const timezoneSchema = z
  .string()
  .trim()
  .refine(
    (value) => VALID_TIME_ZONES.has(value),
    'Must be a valid IANA time zone identifier (e.g. "Europe/Warsaw")',
  );

// Structural check only (3 uppercase letters), not a maintained ISO 4217
// list - mirrors the slug/language-code pattern-based validation used
// elsewhere (see slugify.ts, query.schemas.ts).
export const currencyCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be a 3-letter ISO 4217 currency code');

/**
 * A URL field that is optional/nullable end-to-end, same normalization
 * convention as optionalNullableText (songs/dto/song-validation.helpers.ts)
 * but validated as a URL when present.
 */
export function optionalNullableUrl(maxLength: number) {
  return z
    .string()
    .trim()
    .url('Must be a valid URL')
    .max(maxLength, `Must be at most ${maxLength} characters`)
    .nullish()
    .transform((value) => (value ? value : null));
}
