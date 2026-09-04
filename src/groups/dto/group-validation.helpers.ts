import { z } from 'zod';
import { getCityByGeonameId } from '../../common/geo/city-directory';
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

// Free text - kept only for display, compatibility, and simple filtering
// (see group.entity.ts) - `geonameId` (below) is the actual source of
// truth for identity; this must equal that record's own `name` exactly
// (see refineCityIdentification). Required on both Group and Section - an
// empty/missing value is rejected, never silently normalized to null
// (unlike the other optional free-text fields on this aggregate, e.g.
// description).
export const citySchema = z.string().trim().min(1).max(100);

// The admin1 region name (e.g. "Mazovia") - exactly the value
// GET /discovery/cities returns as `region` for the chosen city (see
// CityResultDto), and exactly what refineCityIdentification checks it
// against. Nullable (not every place has an admin1 region in the source -
// see city-directory.ts), but not optional-by-omission the way the other
// free-text fields on this aggregate are: once `geonameId` is given, its
// `region` is a specific, known value (possibly `null`) that the caller
// must echo back exactly, so this schema does not itself decide whether a
// missing key means "null" versus "wrong" - refineCityIdentification does,
// by comparing against the one real answer.
export const regionSchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .nullish()
  .transform((value) => (value ? value : null));

// The GeoNames-assigned, globally stable identifier for a place (see
// common/geo/city-directory.ts) - the actual source of truth `country`/
// `city`/`region` are cross-checked against (see refineCityIdentification
// below). Always a positive integer in the real dataset.
export const geonameIdSchema = z.number().int().positive();

/**
 * Cross-field check for a Zod object shaped `{ geonameId, country, city,
 * region }` (each already validated individually by geonameIdSchema/
 * countryCodeSchema/citySchema/regionSchema) - confirms `country`/`city`/
 * `region` are *exactly* the record `geonameId` refers to, using the same
 * dataset the city-search endpoint itself is built on (see
 * common/geo/city-directory.ts and discovery/city-search.service.ts) so
 * the two can never drift ("only accept a city you could also have found
 * through search"). Attach via `.superRefine(refineCityIdentification)` -
 * `.refine()` cannot express several dependent fields with one error
 * `path`.
 *
 * `geonameId` is the single source of truth for *which* place this is -
 * unlike the previous, id-less design (a city name is not unique within a
 * country: e.g. two different Polish towns are both named "Piaski", in
 * different regions), there is no remaining ambiguity to resolve here: a
 * `geonameId` names one exact place, so this only ever needs to check that
 * `country`/`city`/`region` are consistent with it, never to disambiguate
 * between several candidates.
 */
export function refineCityIdentification(
  data: {
    geonameId: number;
    country: string;
    city: string;
    region?: string | null;
  },
  ctx: z.RefinementCtx,
): void {
  const record = getCityByGeonameId(data.geonameId);

  if (!record) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message:
        'geonameId does not refer to a known city (see GET /discovery/cities)',
      path: ['geonameId'],
    });
    return;
  }

  if (record.country !== data.country) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'country does not match the city referenced by geonameId',
      path: ['country'],
    });
  }

  if (record.name !== data.city) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'city does not match the city referenced by geonameId',
      path: ['city'],
    });
  }

  if (record.region !== (data.region ?? null)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'region does not match the city referenced by geonameId',
      path: ['region'],
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

// A bare domain, optionally with a scheme and/or "www." - matches how a
// person actually types a website/Facebook/Instagram/YouTube address by
// hand: "example.com", "www.example.com", "http(s)://example.com",
// "https://www.example.com/path?x=1". Requires at least a two-label
// domain (so "localhost" or a single word is still rejected) but is
// otherwise permissive - this is a "does it look like a URL at all" check,
// not a strict RFC 3986 parse (see optionalNullableUrl above for that).
const LENIENT_URL_PATTERN =
  /^(https?:\/\/)?(www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+(?::\d+)?([/?#]\S*)?$/i;

/**
 * Same optional/nullable/max-length shape as optionalNullableUrl, but
 * accepts any of the formats LENIENT_URL_PATTERN describes and normalizes
 * the result to a fully-qualified https:// URL (only when no scheme was
 * given) so downstream consumers that require one (e.g. the mobile app's
 * Linking.openURL) always get a usable link, without forcing the caller to
 * type "https://" themselves.
 */
export function optionalNullableSocialUrl(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, `Must be at most ${maxLength} characters`)
    .regex(LENIENT_URL_PATTERN, 'Must be a valid URL')
    .nullish()
    .transform((value) => {
      if (!value) {
        return null;
      }
      return /^https?:\/\//i.test(value) ? value : `https://${value}`;
    });
}
