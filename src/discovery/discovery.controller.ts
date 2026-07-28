import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { DiscoveredResourceDto } from './discovery-response.dto';
import { DiscoveryService } from './discovery.service';
import { CommunitySearchResultDto } from './dto/community-search-result.dto';
import {
  DiscoverySearchQueryDto,
  discoverySearchQuerySchema,
} from './dto/discovery-search-query.schema';

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discoveryService: DiscoveryService) {}

  /**
   * GET /discovery/resolve/:code
   *
   * Resolve any resource (Group or User) by its publicCode.
   * Works even for isHidden resources - the public code is the bypass.
   * The code is case-insensitive.
   */
  @Get('resolve/:code')
  resolveByCode(
    @Param('code') code: string,
    @CurrentUser() user: User,
  ): Promise<DiscoveredResourceDto> {
    return this.discoveryService.resolveByCode(code, user);
  }

  /**
   * GET /discovery/search?name=&country=&city=&type=&page=&limit=
   *
   * "Discover Community" - the only way to browse Groups/Sections. At
   * least one of name/country/city is required (400 VALIDATION_ERROR
   * otherwise) - there is deliberately no unfiltered "list everything"
   * endpoint. `type=GROUP`/`type=SECTION` narrows to one tab; omit it for
   * the "All" tab. See discoverySearchQuerySchema and
   * DiscoveryService.search for the full contract.
   */
  @Get('search')
  search(
    @Query(new ZodValidationPipe(discoverySearchQuerySchema))
    query: DiscoverySearchQueryDto,
  ): Promise<PaginatedResponse<CommunitySearchResultDto>> {
    return this.discoveryService.search(query);
  }
}
