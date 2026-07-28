import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  CreateRoleAssignmentDto,
  createRoleAssignmentSchema,
} from './dto/create-role-assignment.schema';
import { RoleAssignmentResponseDto } from './dto/role-assignment-response.dto';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { RoleAssignmentsService } from './role-assignments.service';

// Manages Role Assignments for a specific Group or Section directly (see
// ADR-028) - dual-mounted since Roles are level-agnostic (a Membership can
// hold a Role for the root Group or for any Section, at any depth). This is
// a distinct concern from GroupsController's members/:membershipId
// endpoints, which only ever touch the root Group Role Assignments
// implicitly created by addMember. Granting a Role here for a Section
// requires the target Membership to already be ACTIVE in that Section's own
// Root Group (see RoleAssignmentsService.grantRole) - reuses the same
// MEMBERSHIP_* permission tier as root-level member management, since
// managing who holds which Role in a Group-kind entity is the same
// administrative capability regardless of whether it is the root Group or a
// Section.
//
// There is deliberately no PATCH here: Roles are independent of one
// another (a Membership may hold several for the same Group at once - see
// ADR-028), so there is no single Role left to "change" - grant (POST) and
// revoke (DELETE) are the only two mutations.
@Controller([
  'groups/:groupId/role-assignments',
  'sections/:sectionId/role-assignments',
])
@UseGuards(GroupPermissionsGuard)
export class RoleAssignmentsController {
  constructor(
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  @Post()
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ROLE_CHANGE)
  create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createRoleAssignmentSchema))
    dto: CreateRoleAssignmentDto,
    @CurrentUser() user: User,
  ): Promise<RoleAssignmentResponseDto> {
    return this.roleAssignmentsService.grantRole(
      groupId ?? sectionId,
      dto,
      user,
    );
  }

  @Get()
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    return this.roleAssignmentsService.listRoleAssignments(
      groupId ?? sectionId,
    );
  }

  @Get(':roleAssignmentId')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  getById(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('roleAssignmentId', ParseUUIDPipe) roleAssignmentId: string,
  ): Promise<RoleAssignmentResponseDto> {
    return this.roleAssignmentsService.getRoleAssignment(
      groupId ?? sectionId,
      roleAssignmentId,
    );
  }

  @Delete(':roleAssignmentId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ROLE_CHANGE)
  revoke(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('roleAssignmentId', ParseUUIDPipe) roleAssignmentId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.roleAssignmentsService.revokeRole(
      groupId ?? sectionId,
      roleAssignmentId,
      user,
    );
  }
}
