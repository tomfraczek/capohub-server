import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CommunityOverviewService } from './community-overview.service';
import {
  CommunityOverviewMineQueryDto,
  communityOverviewMineQuerySchema,
  CommunityOverviewNearbyQueryDto,
  communityOverviewNearbyQuerySchema,
} from './dto/community-overview-query.schema';
import {
  CommunityGroupCardDto,
  CommunitySectionCardDto,
  NearbyGroupCardDto,
  NearbySectionCardDto,
} from './dto/community-overview-response.dto';

/**
 * The paginated "See all" counterpart to GET /community/home's capped
 * mySections/myGroups/nearbySections/nearbyGroups cards (see
 * CommunityHomeController/CommunityHomeService) - same underlying
 * CommunityOverviewService, so neither surface can define "mine" or
 * "nearby" differently from the other. Home fetches a few cards for a
 * carousel; these four routes are the real, fully paginated lists behind
 * each of Home's "See all" affordances.
 */
@Controller('community')
export class CommunityOverviewController {
  constructor(
    private readonly communityOverviewService: CommunityOverviewService,
  ) {}

  @Get('sections/mine')
  async listMySections(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityOverviewMineQuerySchema))
    query: CommunityOverviewMineQueryDto,
  ): Promise<PaginatedResponse<CommunitySectionCardDto>> {
    const result = await this.communityOverviewService.getMySections(user.id, {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }

  @Get('groups/mine')
  async listMyGroups(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityOverviewMineQuerySchema))
    query: CommunityOverviewMineQueryDto,
  ): Promise<PaginatedResponse<CommunityGroupCardDto>> {
    const result = await this.communityOverviewService.getMyGroups(user.id, {
      limit: query.limit,
      offset: (query.page - 1) * query.limit,
    });
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }

  @Get('sections/nearby')
  async listNearbySections(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityOverviewNearbyQuerySchema))
    query: CommunityOverviewNearbyQueryDto,
  ): Promise<PaginatedResponse<NearbySectionCardDto>> {
    const result = await this.communityOverviewService.getNearbySections(
      user.id,
      {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        radiusKm: query.radiusKm,
      },
    );
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }

  @Get('groups/nearby')
  async listNearbyGroups(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityOverviewNearbyQuerySchema))
    query: CommunityOverviewNearbyQueryDto,
  ): Promise<PaginatedResponse<NearbyGroupCardDto>> {
    const result = await this.communityOverviewService.getNearbyGroups(
      user.id,
      {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
        radiusKm: query.radiusKm,
      },
    );
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }

  // The paginated "Zobacz wszystkie" counterpart to Home's discoverySections
  // carousel when discoveryContext.fallbackType is 'COUNTRY' (see
  // CommunityHomeService/CommunityOverviewService.getCountryDiscoverySections)
  // - the EXPANDED_RADIUS tier has no equivalent route of its own, it
  // reuses GET /community/sections/nearby?radiusKm=150 instead (same
  // underlying getNearbySections, just a wider radius).
  @Get('sections/discover')
  async listDiscoverSections(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityOverviewMineQuerySchema))
    query: CommunityOverviewMineQueryDto,
  ): Promise<PaginatedResponse<NearbySectionCardDto>> {
    const result =
      await this.communityOverviewService.getCountryDiscoverySections(user.id, {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }

  @Get('groups/discover')
  async listDiscoverGroups(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityOverviewMineQuerySchema))
    query: CommunityOverviewMineQueryDto,
  ): Promise<PaginatedResponse<NearbyGroupCardDto>> {
    const result =
      await this.communityOverviewService.getCountryDiscoveryGroups(user.id, {
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      });
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }
}
