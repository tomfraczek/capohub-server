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
import { BanMemberDto, banMemberSchema } from './dto/ban-member.schema';
import { CreateGroupDto, createGroupSchema } from './dto/create-group.schema';
import { GroupMembershipResponseDto } from './dto/group-membership-response.dto';
import { GroupResponseDto } from './dto/group-response.dto';
import { GroupSummaryResponseDto } from './dto/group-summary-response.dto';
import {
  SuspendMemberDto,
  suspendMemberSchema,
} from './dto/suspend-member.schema';
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
  GroupStatus.DELETED,
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
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.update(id, dto, user);
  }

  // Valid from both ACTIVE and READ_ONLY (spec transition table); already
  // ARCHIVED is blocked by the guard with 409 GROUP_ARCHIVED.
  @Post(':id/archive')
  @RequireGroupPermission(GroupPermission.GROUP_ARCHIVE)
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
  @AllowGroupStatuses(GroupStatus.READ_ONLY)
  activate(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.groupsService.activate(id, user);
  }

  // Permanent, irreversible deletion (see ADR-029) - distinct from Archive,
  // which remains fully reversible. Valid from ACTIVE, READ_ONLY, or
  // ARCHIVED; already-DELETED is blocked by the guard with 409
  // GROUP_DELETED, same mechanism as every other terminal-status guard.
  @Post(':id/delete')
  @RequireGroupPermission(GroupPermission.GROUP_DELETE)
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

  @Get(':id/children')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  listChildren(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GroupResponseDto[]> {
    return this.groupsService.listChildren(id);
  }

  @Post(':id/transfer-ownership')
  @RequireGroupPermission(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
  transferOwnership(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    dto: TransferOwnershipDto,
  ): Promise<TransferOwnershipResponseDto> {
    return this.groupMembershipsService.transferOwnership(
      id,
      user.id,
      dto,
      user,
    );
  }

  @Post(':id/leave')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  leave(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.groupMembershipsService.leave(id, user);
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
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ADD)
  addMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
  ): Promise<GroupMembershipResponseDto> {
    return this.groupMembershipsService.addMember(id, dto);
  }

  // A membership that has ended remains readable as history (see
  // organization-entities.md#membership) - not filtered to ANY_STATUS by
  // accident, this endpoint is meant to serve archived memberships too.
  @Get(':id/members/:membershipId')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  getMembership(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
  ): Promise<GroupMembershipResponseDto> {
    return this.groupMembershipsService.getMembership(id, membershipId);
  }

  // There is no PATCH .../members/:membershipId to "change the member's
  // role": a Membership may hold several Roles for the same Group at once
  // (see ADR-028), so there is no longer a single Role to target by this
  // route. Granting, changing, or revoking a specific Role - for the Root
  // Group or any Child Group - always goes through
  // RoleAssignmentsController (/groups/:groupId/role-assignments/...).
  @Delete(':id/members/:membershipId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_REMOVE)
  removeMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.groupMembershipsService.removeMember(id, membershipId, user);
  }

  // Ends the Membership (like removeMember) and additionally blocks the
  // user from rejoining/being re-invited until unbanned - see GroupBan.
  @Post(':id/members/:membershipId/ban')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_BAN)
  banMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(banMemberSchema)) dto: BanMemberDto,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.groupMembershipsService.banMember(
      id,
      membershipId,
      user,
      dto.reason ?? null,
    );
  }

  // Lifts the ban - does not restore the Membership itself, see
  // GroupMembershipsService.unbanMember. Same default (ACTIVE-only) status
  // gate as every other member-management action - unarchive the Group
  // first if it isn't ACTIVE.
  @Post(':id/members/:membershipId/unban')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_UNBAN)
  unbanMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.groupMembershipsService.unbanMember(id, membershipId, user);
  }

  // Sets Membership.status to READ_ONLY for a bounded (or indefinite) time
  // window - see MembershipSuspension and GroupMembershipsService.
  @Post(':id/members/:membershipId/suspend')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_SUSPEND)
  suspendMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(suspendMemberSchema)) dto: SuspendMemberDto,
    @CurrentUser() user: User,
  ): Promise<GroupMembershipResponseDto> {
    return this.groupMembershipsService.suspendMember(
      id,
      membershipId,
      user,
      dto.until ? new Date(dto.until) : null,
      dto.reason ?? null,
    );
  }

  // Only valid while the Membership is currently suspended (READ_ONLY) -
  // enforced in the service, not by @AllowGroupStatuses (that decorator
  // gates the *Group's* status, not the Membership's).
  @Post(':id/members/:membershipId/unsuspend')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_UNSUSPEND)
  unsuspendMember(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<GroupMembershipResponseDto> {
    return this.groupMembershipsService.unsuspendMember(id, membershipId, user);
  }

  @Post(':id/members/:membershipId/sections/:sectionId')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_SECTION_ASSIGN)
  assignSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<void> {
    return this.groupMembershipsService.assignSection(
      id,
      membershipId,
      sectionId,
    );
  }

  @Delete(':id/members/:membershipId/sections/:sectionId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_SECTION_ASSIGN)
  unassignSection(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<void> {
    return this.groupMembershipsService.unassignSection(
      id,
      membershipId,
      sectionId,
    );
  }
}
