import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CommunityNotificationSettingsService } from './community-notification-settings.service';
import { CommunityNotificationSettingsResponseDto } from './dto/community-notification-settings-response.dto';
import {
  UpdateCommunityNotificationSettingsDto,
  updateCommunityNotificationSettingsSchema,
} from './dto/update-community-notification-settings.schema';

// Deliberately no GroupPermissionsGuard here (unlike every other controller
// in this module) - see CommunityNotificationSettingsService's own comment
// for why: that guard requires at least one Role Assignment to resolve
// authorization at all, which would make this unreachable for a valid,
// documented zero-Role Group Membership. Authorization is a direct
// Membership check inside the service instead.
@Controller('groups/:groupId/notification-settings')
export class CommunityNotificationSettingsController {
  constructor(
    private readonly communityNotificationSettingsService: CommunityNotificationSettingsService,
  ) {}

  @Get()
  get(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @CurrentUser() user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.communityNotificationSettingsService.get(groupId, user);
  }

  @Patch()
  update(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(updateCommunityNotificationSettingsSchema))
    dto: UpdateCommunityNotificationSettingsDto,
    @CurrentUser() user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.communityNotificationSettingsService.update(groupId, user, dto);
  }
}
