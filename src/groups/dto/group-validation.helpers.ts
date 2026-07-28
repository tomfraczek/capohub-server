import { z } from 'zod';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';

// IANA time zone database is the runtime's own source of truth - no
// hand-maintained list to fall out of date.
const VALID_TIME_ZONES = new Set(Intl.supportedValuesOf('timeZone'));

// ISO 3166-1 alpha-2 only (e.g. "PL", "DE", "BR") - never a free-text
// country name. Uppercased before checking so "pl"/"Pl" are accepted and
// normalized, matching currencyCodeSchema's convention below. Required by
// default; wrap with `.optional()` at the call site for a Group (which may
// span multiple countries - see create-group.schema.ts) rather than making
// this schema itself optional, so a Section's requirement stays enforced
// by construction.
export const countryCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .refine(
    isValidIsoCountryCode,
    'Must be a valid ISO 3166-1 alpha-2 country code',
  );

// Free text - there is no canonical machine-checkable city list. Optional
// and nullable on both Group and Section (see the country/city rollout in
// the Group/Section rename ADR).
export const citySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .nullish()
  .transform((value) => (value ? value : null));

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
