import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { integerQueryParam } from '../../common/validation/query.schemas';
import {
  MAX_HOME_SEARCH_RADIUS_KM,
  MAX_NEARBY_RADIUS_KM,
} from '../community-overview.constants';
import { locationContextQuerySchema } from './community-location-context.schema';

// GET /community/{sections,groups}/mine - plain pagination, no extra filter
// (never takes a location context - "mine" doesn't depend on where the
// caller is).
export const communityOverviewMineQuerySchema = paginationQuerySchema;

export class CommunityOverviewMineQueryDto extends createZodDto(
  communityOverviewMineQuerySchema,
) {}

export type CommunityOverviewMineQuery = z.infer<
  typeof communityOverviewMineQuerySchema
>;

// GET /community/home - the caller's resolved location context plus the
// search radius (km) they picked for it (mobile "Odkryj sekcje" slider).
// The radius is a per-request filter, identical whether the location is
// device GPS or a SavedLocation - never read from the stored location.
// Omitted -> DEFAULT_NEARBY_RADIUS_KM.
export const communityHomeQuerySchema = locationContextQuerySchema.extend({
  radiusKm: integerQueryParam(
    z.number().int().positive().max(MAX_HOME_SEARCH_RADIUS_KM),
  ).optional(),
});

export class CommunityHomeQueryDto extends createZodDto(
  communityHomeQuerySchema,
) {}

export type CommunityHomeQuery = z.infer<typeof communityHomeQuerySchema>;

// GET /community/{sections,groups}/nearby - pagination, the search radius
// (km, same per-request filter as on /home; up to MAX_NEARBY_RADIUS_KM so
// the expanded-radius tier's own list can pass EXPANDED_NEARBY_RADIUS_KM),
// plus the caller's resolved location context (see
// community-location-context.schema.ts).
export const communityOverviewNearbyQuerySchema = paginationQuerySchema
  .merge(locationContextQuerySchema)
  .extend({
    radiusKm: integerQueryParam(
      z.number().int().positive().max(MAX_NEARBY_RADIUS_KM),
    ).optional(),
  });

export class CommunityOverviewNearbyQueryDto extends createZodDto(
  communityOverviewNearbyQuerySchema,
) {}

export type CommunityOverviewNearbyQuery = z.infer<
  typeof communityOverviewNearbyQuerySchema
>;

// GET /community/{sections,groups}/discover - the paginated "Zobacz
// wszystkie" counterpart to Home's COUNTRY-tier discoverySections/
// discoveryGroups (see CommunityOverviewService.getCountryDiscoverySections/
// getCountryDiscoveryGroups) - pagination plus the location context (needs
// `countryCode` specifically, unlike /nearby which only needs lat/lng).
export const communityOverviewDiscoverQuerySchema = paginationQuerySchema.merge(
  locationContextQuerySchema,
);

export class CommunityOverviewDiscoverQueryDto extends createZodDto(
  communityOverviewDiscoverQuerySchema,
) {}

export type CommunityOverviewDiscoverQuery = z.infer<
  typeof communityOverviewDiscoverQuerySchema
>;
