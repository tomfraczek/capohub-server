import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  CreateSectionDto,
  createSectionSchema,
} from './dto/create-section.schema';
import { SectionResponseDto } from './dto/section-response.dto';
import {
  UpdateSectionDto,
  updateSectionSchema,
} from './dto/update-section.schema';
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
] as const;

// Section always belongs to exactly one Group and is never independently
// addressable - every route is nested under the owning Group, same
// structure as AcademiesController.
@Controller('groups/:groupId/sections')
@UseGuards(GroupPermissionsGuard)
export class SectionsController {
  constructor(private readonly sectionsService: SectionsService) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.SECTION_CREATE)
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(createSectionSchema)) dto: CreateSectionDto,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.create(groupId, dto);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.SECTION_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<SectionResponseDto[]> {
    return this.sectionsService.list(groupId);
  }

  @Get(':sectionId')
  @RequireGroupPermission(GroupPermission.SECTION_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.getById(groupId, sectionId);
  }

  @Patch(':sectionId')
  @RequireGroupPermission(GroupPermission.SECTION_EDIT)
  update(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body(new ZodValidationPipe(updateSectionSchema)) dto: UpdateSectionDto,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.update(groupId, sectionId, dto);
  }

  @Post(':sectionId/archive')
  @RequireGroupPermission(GroupPermission.SECTION_ARCHIVE)
  archive(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.archive(groupId, sectionId);
  }
}
