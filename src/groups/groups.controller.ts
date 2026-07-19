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
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import { AddMemberDto, addMemberSchema } from './dto/add-member.schema';
import {
  ChangeMemberRoleDto,
  changeMemberRoleSchema,
} from './dto/change-member-role.schema';
import { CreateGroupDto, createGroupSchema } from './dto/create-group.schema';
import { GroupMembershipResponseDto } from './dto/group-membership-response.dto';
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
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupMembershipsService } from './group-memberships.service';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupsService } from './groups.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
] as const;

// GroupPermissionsGuard is applied once at the class level; it only takes
// effect on handlers decorated with @RequireGroupPermission(...), which read
// the group id from :id (see GroupPermissionsGuard). create() and list() act
// on no specific group yet, so they carry no such decorator and pass
// through unguarded (beyond the global ClerkAuthGuard).
@Controller('groups')
@UseGuards(GroupPermissionsGuard)
export class GroupsController {
  constructor(
    private readonly groupsService: GroupsService,
    private readonly groupMembershipsService: GroupMembershipsService,
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
  @AllowGroupStatuses(...ANY_STATUS)
  getById(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponseDto> {
    return this.groupsService.getById(id);
  }

  @Patch(':id')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(updateGroupSchema)) dto: UpdateGroupDto,
  ): Promise<GroupResponseDto> {
    return this.groupsService.update(id, dto);
  }

  // Valid from both ACTIVE and READ_ONLY (spec transition table); already
  // ARCHIVED is blocked by the guard with 409 GROUP_ARCHIVED.
  @Post(':id/archive')
  @RequireGroupPermission(GroupPermission.GROUP_ARCHIVE)
  @AllowGroupStatuses(GroupStatus.ACTIVE, GroupStatus.READ_ONLY)
  archive(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponseDto> {
    return this.groupsService.archive(id);
  }

  // Only valid from ARCHIVED - ARCHIVED -> READ_ONLY is not a supported
  // transition, so this must not accept a READ_ONLY starting point.
  @Post(':id/unarchive')
  @RequireGroupPermission(GroupPermission.GROUP_UNARCHIVE)
  @AllowGroupStatuses(GroupStatus.ARCHIVED)
  unarchive(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponseDto> {
    return this.groupsService.unarchive(id);
  }

  // Only valid from ACTIVE.
  @Post(':id/read-only')
  @RequireGroupPermission(GroupPermission.GROUP_SET_READ_ONLY)
  @AllowGroupStatuses(GroupStatus.ACTIVE)
  setReadOnly(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GroupResponseDto> {
    return this.groupsService.setReadOnly(id);
  }

  // Only valid from READ_ONLY - ARCHIVED must go through /unarchive instead.
  @Post(':id/activate')
  @RequireGroupPermission(GroupPermission.GROUP_ACTIVATE)
  @AllowGroupStatuses(GroupStatus.READ_ONLY)
  activate(@Param('id', ParseUUIDPipe) id: string): Promise<GroupResponseDto> {
    return this.groupsService.activate(id);
  }

  @Post(':id/transfer-ownership')
  @RequireGroupPermission(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
  transferOwnership(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    dto: TransferOwnershipDto,
  ): Promise<TransferOwnershipResponseDto> {
    return this.groupMembershipsService.transferOwnership(id, user.id, dto);
  }

  @Post(':id/leave')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.groupMembershipsService.leave(id, user.id);
  }

  @Get(':id/members')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  listMembers(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GroupMembershipResponseDto[]> {
    return this.groupMembershipsService.listMembers(id);
  }

  @Post(':id/members')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.GROUP_MEMBER_ADD)
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
  ): Promise<GroupMembershipResponseDto> {
    return this.groupMembershipsService.addMember(id, dto);
  }

  @Patch(':id/members/:membershipId')
  @RequireGroupPermission(GroupPermission.GROUP_MEMBER_ROLE_CHANGE)
  changeMemberRole(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(changeMemberRoleSchema))
    dto: ChangeMemberRoleDto,
  ): Promise<GroupMembershipResponseDto> {
    return this.groupMembershipsService.changeRole(id, membershipId, dto);
  }

  @Delete(':id/members/:membershipId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.GROUP_MEMBER_REMOVE)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<void> {
    return this.groupMembershipsService.removeMember(id, membershipId);
  }
}
