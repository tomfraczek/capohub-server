import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  CreateSectionDto,
  createSectionSchema,
} from './dto/create-section.schema';
import { SectionResponseDto } from './dto/section-response.dto';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { SectionsService } from './sections.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Creates/lists Sections directly under a Group. As of the
// Group/Section physical split (organizational-domain rebuild, stage 1), a
// Section can never have children - it may only ever be attached to a
// Group - so the old dual-mounted 'sections/:sectionId/sections' path
// (creating a Section under another Section) no longer has any meaning and
// has been removed; only 'groups/:groupId/sections' remains. Single-
// resource operations on one specific Section (get/update/lifecycle) live
// on SectionController (sections/:sectionId).
@Controller('groups/:groupId/sections')
@UseGuards(GroupPermissionsGuard)
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.SECTION_CREATE)
  create(
    @Param('groupId') groupId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createSectionSchema)) dto: CreateSectionDto,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.create(groupId, user, dto);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.SECTION_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId') groupId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto[]> {
    return this.sectionsService.list(groupId, user.id);
  }
}
