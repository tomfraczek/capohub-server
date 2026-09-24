import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { integerQueryParam } from '../../common/validation/query.schemas';
import { MAX_NEARBY_RADIUS_KM } from '../community-overview.constants';
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

// GET /community/{sections,groups}/nearby - pagination, an optional radius
// override (km), plus the caller's resolved location context (see
// community-location-context.schema.ts) - GET /community/home never
// accepts a radius override and always uses DEFAULT_NEARBY_RADIUS_KM (see
// CommunityOverviewService).
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
