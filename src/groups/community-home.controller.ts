import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { CommunityHomeService } from './community-home.service';
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
   * GET /community/home
   */
  @Get('home')
  getHome(@CurrentUser() user: User): Promise<CommunityHomeResponseDto> {
    return this.communityHomeService.getHome(user);
  }
}
