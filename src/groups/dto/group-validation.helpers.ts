import { z } from 'zod';

// IANA time zone database is the runtime's own source of truth - no
// hand-maintained list to fall out of date.
const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

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
