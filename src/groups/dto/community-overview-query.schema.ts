import { z } from 'zod';
import { createZodDto } from '../../common/dto/create-zod-dto';
import { paginationQuerySchema } from '../../common/pagination/pagination-query.schema';
import { integerQueryParam } from '../../common/validation/query.schemas';
import { MAX_NEARBY_RADIUS_KM } from '../community-overview.constants';

// GET /community/{sections,groups}/mine - plain pagination, no extra filter.
export const communityOverviewMineQuerySchema = paginationQuerySchema;

export class CommunityOverviewMineQueryDto extends createZodDto(
  communityOverviewMineQuerySchema,
) {}

export type CommunityOverviewMineQuery = z.infer<
  typeof communityOverviewMineQuerySchema
>;

// GET /community/{sections,groups}/nearby - pagination plus an optional
// radius override (km) - GET /community/home never accepts one and always
// uses DEFAULT_NEARBY_RADIUS_KM (see CommunityOverviewService).
export const communityOverviewNearbyQuerySchema = paginationQuerySchema.extend({
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
