import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { HomeResponseDto } from './dto/home-response.dto';
import { HomeService } from './home.service';

// Backs the mobile app's Home screen - one request, no :groupId/:userId
// param, same "no single resource to check a permission against" shape as
// CommunityHomeController (see community-home.controller.ts). Every
// section's own authorization is already resolved by the service it comes
// from (see HomeService's own top comment).
@Controller('home')
export class HomeController {
  constructor(private readonly homeService: HomeService) {}

  /**
   * GET /home
   */
  @Get()
  getHome(@CurrentUser() user: User): Promise<HomeResponseDto> {
    return this.homeService.getHome(user);
  }
}
