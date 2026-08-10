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
import { GroupNotificationSettingsResponseDto } from './dto/group-notification-settings-response.dto';
import {
  UpdateGroupNotificationSettingsDto,
  updateGroupNotificationSettingsSchema,
} from './dto/update-group-notification-settings.schema';

// The Group analog of CommunityNotificationSettingsController (Section) -
// see that controller's own comment and
// CommunityNotificationSettingsService's class comment for why this
// deliberately has no GroupPermissionsGuard either. Minimal {muted}-only
// shape - see GroupNotificationSettingsResponseDto's own comment.
@Controller('groups/:groupId/notification-settings')
export class GroupNotificationSettingsController {
  constructor(
    private readonly communityNotificationSettingsService: CommunityNotificationSettingsService,
  ) {}

  @Get()
  get(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @CurrentUser() user: User,
  ): Promise<GroupNotificationSettingsResponseDto> {
    return this.communityNotificationSettingsService.getForGroup(groupId, user);
  }

  @Patch()
  update(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(updateGroupNotificationSettingsSchema))
    dto: UpdateGroupNotificationSettingsDto,
    @CurrentUser() user: User,
  ): Promise<GroupNotificationSettingsResponseDto> {
    return this.communityNotificationSettingsService.updateForGroup(
      groupId,
      user,
      dto,
    );
  }
}
