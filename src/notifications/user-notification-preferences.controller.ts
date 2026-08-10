import { Body, Controller, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { UserNotificationPreferencesResponseDto } from './dto/user-notification-preferences-response.dto';
import {
  UpdateUserNotificationPreferencesDto,
  updateUserNotificationPreferencesSchema,
} from './dto/update-user-notification-preferences.schema';
import { UserNotificationPreferencesService } from './user-notification-preferences.service';

@Controller('users/me/notification-preferences')
export class UserNotificationPreferencesController {
  constructor(
    private readonly userNotificationPreferencesService: UserNotificationPreferencesService,
  ) {}

  @Get()
  get(
    @CurrentUser() user: User,
  ): Promise<UserNotificationPreferencesResponseDto> {
    return this.userNotificationPreferencesService.get(user);
  }

  @Patch()
  update(
    @Body(new ZodValidationPipe(updateUserNotificationPreferencesSchema))
    dto: UpdateUserNotificationPreferencesDto,
    @CurrentUser() user: User,
  ): Promise<UserNotificationPreferencesResponseDto> {
    return this.userNotificationPreferencesService.update(user, dto);
  }
}
