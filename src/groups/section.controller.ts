import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { GroupMembershipsService } from './group-memberships.service';
import { SectionResponseDto } from './dto/section-response.dto';
import { TransferOwnershipResponseDto } from './dto/transfer-ownership-response.dto';
import {
  TransferOwnershipDto,
  transferOwnershipSchema,
} from './dto/transfer-ownership.schema';
import {
  UpdateSectionDto,
  updateSectionSchema,
} from './dto/update-section.schema';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import {
  RequireGroupKind,
  GroupKind,
} from './decorators/require-group-kind.decorator';
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

// Single-resource operations on one specific Section, addressed directly by
// id - mirrors GroupsController's :id routes one level down, and the
// EventsController (create/list)/EventController (single resource) split
// already used in this codebase. @RequireGroupKind(GroupKind.SECTION) on
// every handler here ensures a Group id 404s instead of being silently
// served through this route family - a Group is only ever reached via
// /groups/:id (see the Group/Section rename ADR).
@Controller('sections/:sectionId')
@UseGuards(GroupPermissionsGuard)
export class SectionController {
  constructor(
    private readonly sectionsService: SectionsService,
    private readonly groupMembershipsService: GroupMembershipsService,
  ) {}

  @Get()
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.getById(sectionId);
  }

  @Patch()
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.SECTION)
  update(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body(new ZodValidationPipe(updateSectionSchema)) dto: UpdateSectionDto,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.update(sectionId, dto, user);
  }

  // Valid from both ACTIVE and READ_ONLY, mirrors GroupsController.archive.
  @Post('archive')
  @RequireGroupPermission(GroupPermission.GROUP_ARCHIVE)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(GroupStatus.ACTIVE, GroupStatus.READ_ONLY)
  archive(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.archive(sectionId, user);
  }

  @Post('unarchive')
  @RequireGroupPermission(GroupPermission.GROUP_UNARCHIVE)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(GroupStatus.ARCHIVED)
  unarchive(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.unarchive(sectionId, user);
  }

  @Post('read-only')
  @RequireGroupPermission(GroupPermission.GROUP_SET_READ_ONLY)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(GroupStatus.ACTIVE)
  setReadOnly(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.setReadOnly(sectionId, user);
  }

  @Post('activate')
  @RequireGroupPermission(GroupPermission.GROUP_ACTIVATE)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(GroupStatus.READ_ONLY)
  activate(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.activate(sectionId, user);
  }

  @Post('delete')
  @RequireGroupPermission(GroupPermission.GROUP_DELETE)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(
    GroupStatus.ACTIVE,
    GroupStatus.READ_ONLY,
    GroupStatus.ARCHIVED,
  )
  delete(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.delete(sectionId, user);
  }

  // Reuses GroupMembershipsService.transferOwnership directly - it already
  // resolves ownership transfer generically for any Group kind (root or
  // non-root), no Section-specific logic needed (see its own comment).
  @Post('transfer-ownership')
  @RequireGroupPermission(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
  @RequireGroupKind(GroupKind.SECTION)
  transferOwnership(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    dto: TransferOwnershipDto,
  ): Promise<TransferOwnershipResponseDto> {
    return this.groupMembershipsService.transferOwnership(
      sectionId,
      user.id,
      dto,
      user,
    );
  }
}
