import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { isValidIsoCountryCode } from '../../common/validation/iso-3166-alpha2';
import { numberQueryParam } from '../../common/validation/query.schemas';

// Shared by GET /community/home and every GET /community/{sections,groups}/
// {nearby,discover} route - the caller's own resolved "active location"
// (device GPS or a SavedLocation's coordinates), passed explicitly per
// request rather than looked up server-side (see
// CommunityOverviewService's own class comment on why: a user may now have
// several SavedLocations, and DeviceLocation is never persisted at all, so
// there is no longer a single stored row the server could read). Both
// latitude and longitude must be present together, or neither - a request
// with only one is treated the same as neither (no location context), never
// a validation error, since a caller that simply has no active location
// yet (e.g. never granted GPS and has no SavedLocation) legitimately omits
// both.
export const locationContextQuerySchema = z.object({
  latitude: numberQueryParam(z.number().min(-90).max(90)).optional(),
  longitude: numberQueryParam(z.number().min(-180).max(180)).optional(),
  // Required for the COUNTRY discovery-fallback tier only (see
  // CommunityOverviewService.getCountryDiscoverySections/Groups) - every
  // other use of the location context only needs latitude/longitude.
  // Omitting it simply disables that one fallback tier for this request,
  // it is never a validation error on its own.
  countryCode: z
    .string()
    .trim()
    .toUpperCase()
    .refine(
      isValidIsoCountryCode,
      'Must be a valid ISO 3166-1 alpha-2 country code',
    )
    .optional(),
  // Display-only echo for GET /community/home's `location` summary block -
  // never read by any distance/filter logic.
  city: z.string().trim().min(1).max(100).optional(),
  region: z.string().trim().min(1).max(100).optional(),
});

export class LocationContextQueryDto extends createZodDto(
  locationContextQuerySchema,
) {}

export type LocationContextQuery = z.infer<typeof locationContextQuerySchema>;

// Resolved, ready-to-use shape every CommunityOverviewService method takes
// instead of looking up a stored location itself. `null` means "no active
// location for this request" - the exact same "nothing configured" state
// UserDiscoveryLocation absence used to represent.
export interface CommunityLocationContext {
  latitude: number;
  longitude: number;
  countryCode: string | null;
  city: string | null;
  region: string | null;
}

export function resolveLocationContext(
  query: LocationContextQuery,
): CommunityLocationContext | null {
  if (query.latitude === undefined || query.longitude === undefined) {
    return null;
  }
  return {
    latitude: query.latitude,
    longitude: query.longitude,
    countryCode: query.countryCode ?? null,
    city: query.city ?? null,
    region: query.region ?? null,
  };
}
