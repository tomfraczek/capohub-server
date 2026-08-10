import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { NotificationListResponseDto } from './dto/notification-list-response.dto';
import {
  NotificationListQueryDto,
  notificationListQuerySchema,
} from './dto/notification-list-query.schema';
import { UnreadCountResponseDto } from './dto/unread-count-response.dto';
import { NotificationsService } from './notifications.service';

// Self-service only - every route reads/writes exclusively against
// @CurrentUser(), never a :userId param (module spec section 40 - no
// GET /notifications/:userId exists, and mark-read/mark-all-read can only
// ever touch the caller's own rows - see NotificationsService.markRead's
// own IDOR guard).
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notificationsService: NotificationsService) {}

  @Get()
  list(
    @Query(new ZodValidationPipe(notificationListQuerySchema))
    query: NotificationListQueryDto,
    @CurrentUser() user: User,
  ): Promise<NotificationListResponseDto> {
    return this.notificationsService.listForUser(user, query);
  }

  @Get('unread-count')
  async unreadCount(
    @CurrentUser() user: User,
  ): Promise<UnreadCountResponseDto> {
    const count = await this.notificationsService.getUnreadCount(user);
    return { count };
  }

  @Post(':id/read')
  @HttpCode(204)
  markRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.notificationsService.markRead(user, id);
  }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUser() user: User): Promise<void> {
    return this.notificationsService.markAllRead(user);
  }
}
