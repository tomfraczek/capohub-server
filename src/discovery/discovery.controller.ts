import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { DiscoveredResourceDto } from './discovery-response.dto';
import { DiscoveryService } from './discovery.service';

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
   * GET /discovery/groups?q=search
   *
   * Search visible (isHidden = false, status = ACTIVE) Groups.
   * Returns at most 50 results ordered by name.
   */
  @Get('groups')
  searchGroups(
    @Query('q') query: string | undefined,
    @CurrentUser() user: User,
  ): Promise<DiscoveredResourceDto[]> {
    return this.discoveryService.searchVisibleGroups(query, user);
  }
}
