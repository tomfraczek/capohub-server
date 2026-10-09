import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { User } from '../users/entities/user.entity';
import {
  CreateGroupRoleAssignmentDto,
  createGroupRoleAssignmentSchema,
  CreateSectionRoleAssignmentDto,
  createSectionRoleAssignmentSchema,
} from './dto/create-role-assignment.schema';
import { GroupAdminCandidateDto } from './dto/group-admin-candidate.dto';
import {
  GroupAdminCandidatesQueryDto,
  groupAdminCandidatesQuerySchema,
} from './dto/group-admin-candidates-query.schema';
import { RoleAssignmentResponseDto } from './dto/role-assignment-response.dto';
import {
  GroupKind,
  RequireGroupKind,
} from './decorators/require-group-kind.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { RoleAssignmentsService } from './role-assignments.service';

// Manages Role Assignments for a specific Group or Section directly - dual-
// mounted since Roles are level-agnostic (a Group's own OWNER/ADMIN roles
// and a Section's 5-role set are both managed through this one controller,
// each row targeting exactly one Group or Section, never both).
//
// Gated on ROLE_ASSIGNMENT_MANAGE/ROLE_ASSIGNMENT_VIEW (see their own
// comment in group-permission.enum.ts): on a Group OWNER and ADMIN may
// list and grant/revoke ADMIN; on a Section the tiers match the
// GROUP_EDIT/GROUP_VIEW pair these replaced. Neither is public-view-safe,
// so a caller with no Role/Membership gets 404, never the list.
//
// The request body uses `userId`, not a membership id - RoleAssignment has
// no membership relation at all (see role-assignment.entity.ts). Two
// separate schemas (Group vs Section) so an invalid role for the target
// kind is rejected at request-validation time already, not only by the
// service/DB constraint.
//
// There is deliberately no PATCH here: Roles are independent of one
// another (a user may hold several for the same target at once), so there
// is no single Role left to "change" - grant (POST) and revoke (DELETE)
// are the only two mutations.
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
  @RequireGroupPermission(GroupPermission.ROLE_ASSIGNMENT_MANAGE)
  async create(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body() body: unknown,
    @CurrentUser() user: User,
  ): Promise<RoleAssignmentResponseDto> {
    // Which schema applies depends on which of the two mount points
    // matched - resolved here, not via a static @Body(pipe) decorator,
    // since that pipe instance is created once at class-definition time
    // and has no access to which route param is present per-request.
    // Declared `async` so a validation throw becomes a rejected Promise
    // like every other error path here, not a synchronous throw.
    const pipe = new ZodValidationPipe(
      groupId
        ? createGroupRoleAssignmentSchema
        : createSectionRoleAssignmentSchema,
    );
    const dto = pipe.transform(body) as
      CreateGroupRoleAssignmentDto | CreateSectionRoleAssignmentDto;
    return this.roleAssignmentsService.grantRole(
      groupId ?? sectionId,
      dto,
      user,
    );
  }

  @Get()
  @RequireGroupPermission(GroupPermission.ROLE_ASSIGNMENT_VIEW)
  list(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    return this.roleAssignmentsService.listRoleAssignments(
      groupId ?? sectionId,
    );
  }

  // Who may be made a Group ADMIN - the Group's formal members only (see
  // RoleAssignmentsService.listGroupAdminCandidates). Group-only: on the
  // Section mount the kind check 404s. Declared before ':roleAssignmentId'
  // so the static segment is matched first.
  @Get('admin-candidates')
  @RequireGroupPermission(GroupPermission.ROLE_ASSIGNMENT_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  async listAdminCandidates(
    @CurrentUser() user: User,
    @Param('groupId') groupId: string,
    @Query(new ZodValidationPipe(groupAdminCandidatesQuerySchema))
    query: GroupAdminCandidatesQueryDto,
  ): Promise<PaginatedResponse<GroupAdminCandidateDto>> {
    const result = await this.roleAssignmentsService.listGroupAdminCandidates(
      groupId,
      { search: query.search, userId: query.userId, excludeUserId: user.id },
      { limit: query.limit, offset: (query.page - 1) * query.limit },
    );
    return {
      data: result.items,
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems: result.total,
      }),
    };
  }

  @Get(':roleAssignmentId')
  @RequireGroupPermission(GroupPermission.ROLE_ASSIGNMENT_VIEW)
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
  @RequireGroupPermission(GroupPermission.ROLE_ASSIGNMENT_MANAGE)
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
