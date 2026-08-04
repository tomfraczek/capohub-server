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
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { CreateGroupDto, createGroupSchema } from './dto/create-group.schema';
import { GroupResponseDto } from './dto/group-response.dto';
import { GroupSummaryResponseDto } from './dto/group-summary-response.dto';
import { TransferOwnershipResponseDto } from './dto/transfer-ownership-response.dto';
import {
  TransferOwnershipDto,
  transferOwnershipSchema,
} from './dto/transfer-ownership.schema';
import { UpdateGroupDto, updateGroupSchema } from './dto/update-group.schema';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import {
  RequireGroupKind,
  GroupKind,
} from './decorators/require-group-kind.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupsService } from './groups.service';
import { RoleAssignmentsService } from './role-assignments.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// GroupPermissionsGuard is applied once at the class level; it only takes
// effect on handlers decorated with @RequireGroupPermission(...), which read
// the group id from :id (see GroupPermissionsGuard). create() and list() act
// on no specific group yet, so they carry no such decorator and pass
// through unguarded (beyond the global ClerkAuthGuard). Every other handler
// additionally carries @RequireGroupKind(GroupKind.ROOT): a Group is always
// root-level, so a Section id must 404 here rather than being silently
// served - it is only ever reached via /sections/:sectionId
// (SectionController).
//
// Group has no ordinary members at all - only OWNER/ADMIN, managed
// entirely through RoleAssignmentsController (grant/revoke) and
// transferOwnership below. There is deliberately no join/leave/member-list/
// ban/suspend/cohort-assignment here: those only ever make sense where
// real membership exists, i.e. Section (see SectionController).
@Controller('groups')
@UseGuards(GroupPermissionsGuard)
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(createGroupSchema)) dto: CreateGroupDto,
  ): Promise<GroupResponseDto> {
    return this.groupsService.create(user, dto);
  }

  @Get()
  listMine(@CurrentUser() user: User): Promise<GroupSummaryResponseDto[]> {
    return this.groupsService.listMine(user.id);
  }

  @Get(':id')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponseDto> {
    return this.groupsService.getById(id);
  }

  @Patch(':id')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.ROOT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) dto: UpdateGroupDto,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.update(id, dto, user);
  }

  // Valid from both ACTIVE and READ_ONLY (spec transition table); already
  // ARCHIVED is blocked by the guard with 409 GROUP_ARCHIVED.
  @Post(':id/archive')
  @RequireGroupPermission(GroupPermission.GROUP_ARCHIVE)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(GroupStatus.ACTIVE, GroupStatus.READ_ONLY)
  archive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.archive(id, user);
  }

  // Only valid from ARCHIVED - ARCHIVED -> READ_ONLY is not a supported
  // transition, so this must not accept a READ_ONLY starting point.
  @Post(':id/unarchive')
  @RequireGroupPermission(GroupPermission.GROUP_UNARCHIVE)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(GroupStatus.ARCHIVED)
  unarchive(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.unarchive(id, user);
  }

  // Only valid from ACTIVE.
  @Post(':id/read-only')
  @RequireGroupPermission(GroupPermission.GROUP_SET_READ_ONLY)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(GroupStatus.ACTIVE)
  setReadOnly(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.setReadOnly(id, user);
  }

  // Only valid from READ_ONLY - ARCHIVED must go through /unarchive instead.
  @Post(':id/activate')
  @RequireGroupPermission(GroupPermission.GROUP_ACTIVATE)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(GroupStatus.READ_ONLY)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.activate(id, user);
  }

  // Permanent, irreversible deletion - distinct from Archive, which remains
  // fully reversible. Valid from ACTIVE, READ_ONLY, or ARCHIVED;
  // already-DELETED is blocked by the guard with 409 GROUP_DELETED, same
  // mechanism as every other terminal-status guard.
  @Post(':id/delete')
  @RequireGroupPermission(GroupPermission.GROUP_DELETE)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(
    GroupStatus.ACTIVE,
    GroupStatus.READ_ONLY,
    GroupStatus.ARCHIVED,
  )
  delete(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.delete(id, user);
  }

  @Post(':id/transfer-ownership')
  @RequireGroupPermission(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
  @RequireGroupKind(GroupKind.ROOT)
  transferOwnership(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    dto: TransferOwnershipDto,
  ): Promise<TransferOwnershipResponseDto> {
    return this.roleAssignmentsService.transferOwnership(
      id,
      user.id,
      dto.newOwnerUserId,
      user,
    );
  }
}
