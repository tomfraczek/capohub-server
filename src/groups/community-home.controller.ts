import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CommunityHomeService } from './community-home.service';
import { resolveLocationContext } from './dto/community-location-context.schema';
import {
  communityHomeQuerySchema,
  CommunityHomeQueryDto,
} from './dto/community-overview-query.schema';
import { CommunityHomeResponseDto } from './dto/community-home-response.dto';

/**
 * Backs the Community Home dashboard (PAD-001 §10). Aggregates data that
 * already exists across several communities at once, so - unlike every
 * other controller in this module - it carries no GroupPermissionsGuard
 * and no :groupId param: there is no single Group to check a permission
 * against here, only "the current user, across every community they
 * participate in." Authorization for each individual section is instead
 * resolved per-community inside CommunityHomeService, using the same
 * GroupPermissionService every other endpoint uses.
 */
@Controller('community')
export class CommunityHomeController {
  constructor(private readonly communityHomeService: CommunityHomeService) {}

  /**
   * GET /community/home?latitude=&longitude=&countryCode=&city=&region=&radiusKm= -
   * the location params describe the caller's currently active location
   * (device GPS or a SavedLocation) - see community-location-context.schema.ts;
   * `radiusKm` is the search radius picked for it (see communityHomeQuerySchema).
   * Omitted entirely when the caller has no active location yet (never
   * pointed at a location the server itself remembers - see
   * CommunityOverviewService's own class comment).
   */
  @Get('home')
  getHome(
    @CurrentUser() user: User,
    @Query(new ZodValidationPipe(communityHomeQuerySchema))
    query: CommunityHomeQueryDto,
  ): Promise<CommunityHomeResponseDto> {
    return this.communityHomeService.getHome(
      user,
      resolveLocationContext(query),
      query.radiusKm,
    );
  }
}
