import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AllowGroupStatuses } from '../groups/decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from '../groups/decorators/require-group-permission.decorator';
import { GroupStatus } from '../groups/enums/group-status.enum';
import { GroupPermissionsGuard } from '../groups/guards/group-permissions.guard';
import { GroupPermission } from '../groups/permissions/group-permission.enum';
import { User } from '../users/entities/user.entity';
import {
  AnnouncementsService,
  AnnouncementListResult,
} from './announcements.service';
import {
  AnnouncementListQueryDto,
  announcementListQuerySchema,
} from './dto/announcement-list-query.schema';
import { AnnouncementResponseDto } from './dto/announcement-response.dto';
import {
  CreateAnnouncementDto,
  createAnnouncementSchema,
} from './dto/create-announcement.schema';
import {
  UpdateAnnouncementDto,
  updateAnnouncementSchema,
} from './dto/update-announcement.schema';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Announcement always belongs to exactly one Group-kind entity (a root
// Group or a Section) and is never independently addressable - every route
// is nested under the owning entity, dual-mounted since it can attach at
// any level, same structure as AcademiesController/RecipientGroupsController.
// The cross-community "everything I can see" feed (GET /home's
// announcements section) is deliberately NOT a route here - it has no
// single :groupId/:sectionId to authorize against the same way, and is
// only ever called in-process by HomeService (see
// AnnouncementsService.listForViewer).
@Controller([
  'groups/:groupId/announcements',
  'sections/:sectionId/announcements',
])
@UseGuards(GroupPermissionsGuard)
export class AnnouncementsController {
  constructor(private readonly announcementsService: AnnouncementsService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_MANAGE)
  create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createAnnouncementSchema))
    dto: CreateAnnouncementDto,
    @CurrentUser() user: User,
  ): Promise<AnnouncementResponseDto> {
    return this.announcementsService.create(groupId ?? sectionId, dto, user);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(announcementListQuerySchema))
    query: AnnouncementListQueryDto,
    @CurrentUser() user: User,
  ): Promise<AnnouncementListResult> {
    return this.announcementsService.list(groupId ?? sectionId, user, query);
  }

  // Must be declared before the ':announcementId' route below - otherwise
  // "archive" would be matched as an announcementId (Nest/Express resolve
  // routes in registration order, not by specificity).
  @Get('archive')
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_ARCHIVE_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  archive(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Query(new ZodValidationPipe(announcementListQuerySchema))
    query: AnnouncementListQueryDto,
    @CurrentUser() user: User,
  ): Promise<AnnouncementListResult> {
    return this.announcementsService.archive(groupId ?? sectionId, user, query);
  }

  @Get(':announcementId')
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser() user: User,
  ): Promise<AnnouncementResponseDto> {
    return this.announcementsService.getById(
      groupId ?? sectionId,
      announcementId,
      user,
    );
  }

  @Patch(':announcementId')
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_MANAGE)
  update(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @Body(new ZodValidationPipe(updateAnnouncementSchema))
    dto: UpdateAnnouncementDto,
    @CurrentUser() user: User,
  ): Promise<AnnouncementResponseDto> {
    return this.announcementsService.update(
      groupId ?? sectionId,
      announcementId,
      dto,
      user,
    );
  }

  @Delete(':announcementId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_MANAGE)
  remove(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
  ): Promise<void> {
    return this.announcementsService.remove(
      groupId ?? sectionId,
      announcementId,
    );
  }

  @Post(':announcementId/read')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.ANNOUNCEMENT_VIEW)
  markRead(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('announcementId', ParseUUIDPipe) announcementId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.announcementsService.markRead(
      groupId ?? sectionId,
      announcementId,
      user,
    );
  }
}
