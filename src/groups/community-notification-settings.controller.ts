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

// Section-only: Group has no membership, so it has no "own" notification
// preferences to manage - see CommunityNotificationSettingsService's own
// comment. Deliberately no GroupPermissionsGuard here (unlike every other
// controller in this module): that guard requires at least one Role
// Assignment to resolve authorization at all, which would make this
// unreachable for a valid, documented zero-extra-Role member (base MEMBER
// only). Authorization is a direct SectionMembership check inside the
// service instead.
@Controller('sections/:sectionId/notification-settings')
export class CommunityNotificationSettingsController {
  constructor(
    private readonly communityNotificationSettingsService: CommunityNotificationSettingsService,
  ) {}

  @Get()
  get(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.communityNotificationSettingsService.get(sectionId, user);
  }

  @Patch()
  update(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body(new ZodValidationPipe(updateCommunityNotificationSettingsSchema))
    dto: UpdateCommunityNotificationSettingsDto,
    @CurrentUser() user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.communityNotificationSettingsService.update(
      sectionId,
      user,
      dto,
    );
  }
}
