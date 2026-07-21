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
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  ChangeRoleAssignmentDto,
  changeRoleAssignmentSchema,
} from './dto/change-role-assignment.schema';
import {
  CreateRoleAssignmentDto,
  createRoleAssignmentSchema,
} from './dto/create-role-assignment.schema';
import { RoleAssignmentResponseDto } from './dto/role-assignment-response.dto';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { RoleAssignmentsService } from './role-assignments.service';

// Manages Role Assignments for a specific Group directly (Root or Child -
// see ADR-028). This is a distinct concern from GroupsController's
// members/:membershipId endpoints, which only ever touch the Root Group
// Role Assignment implicitly created by addMember/changeRole. Granting a
// Role here for a Child Group requires the target Membership to already be
// ACTIVE in this Group's own Root Group (see
// RoleAssignmentsService.assignRole) - reuses the same MEMBERSHIP_*
// permission tier as root-level member management, since managing who
// holds which Role in a Group is the same administrative capability
// regardless of whether that Group is a Root or a Child.
@Controller('groups/:groupId/role-assignments')
@UseGuards(GroupPermissionsGuard)
export class RoleAssignmentsController {
  constructor(
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ROLE_CHANGE)
  create(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Body(new ZodValidationPipe(createRoleAssignmentSchema))
    dto: CreateRoleAssignmentDto,
  ): Promise<RoleAssignmentResponseDto> {
    return this.roleAssignmentsService.assignRole(groupId, dto);
  }

  @Get()
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  list(
    @Param('groupId', ParseUUIDPipe) groupId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    return this.roleAssignmentsService.listRoleAssignments(groupId);
  }

  @Get(':roleAssignmentId')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  getById(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('roleAssignmentId', ParseUUIDPipe) roleAssignmentId: string,
  ): Promise<RoleAssignmentResponseDto> {
    return this.roleAssignmentsService.getRoleAssignment(
      groupId,
      roleAssignmentId,
    );
  }

  @Patch(':roleAssignmentId')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ROLE_CHANGE)
  changeRole(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('roleAssignmentId', ParseUUIDPipe) roleAssignmentId: string,
    @Body(new ZodValidationPipe(changeRoleAssignmentSchema))
    dto: ChangeRoleAssignmentDto,
  ): Promise<RoleAssignmentResponseDto> {
    return this.roleAssignmentsService.changeRole(
      groupId,
      roleAssignmentId,
      dto,
    );
  }

  @Delete(':roleAssignmentId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ROLE_CHANGE)
  revoke(
    @Param('groupId', ParseUUIDPipe) groupId: string,
    @Param('roleAssignmentId', ParseUUIDPipe) roleAssignmentId: string,
  ): Promise<void> {
    return this.roleAssignmentsService.revokeRole(groupId, roleAssignmentId);
  }
}
