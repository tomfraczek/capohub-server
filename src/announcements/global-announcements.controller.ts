import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import {
  AnnouncementsService,
  AnnouncementListResult,
} from './announcements.service';
import {
  AnnouncementListQueryDto,
  announcementListQuerySchema,
} from './dto/announcement-list-query.schema';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';

// The paginated "see all" screen behind GET /home's announcements preview -
// no :groupId/:sectionId, so it cannot mount under AnnouncementsController
// (which requires exactly one of the two) or go through
// GroupPermissionsGuard (there is no single Group to authorize against).
// Same shape as HomeController: only the global ClerkAuthGuard applies,
// and every section's own visibility is resolved by the service it comes
// from - here, AnnouncementsService.listForViewer, the exact same method
// GET /home's preview calls (see that method's own comment). Never returns
// expired or archived Announcements - there is no cross-community archive
// view, only the per-community one (ANNOUNCEMENT_ARCHIVE_VIEW).
@Controller('announcements')
export class GlobalAnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Get()
  async list(
    @Query(new ZodValidationPipe(announcementListQuerySchema))
    query: AnnouncementListQueryDto,
    @CurrentUser() user: User,
  ): Promise<AnnouncementListResult> {
    const { items, total, hasMore } =
      await this.announcementsService.listForViewer(user, {
        limit: query.limit,
        offset: query.offset,
        unreadOnly: query.unreadOnly,
      });
    return { items, total, hasMore };
  }
}
