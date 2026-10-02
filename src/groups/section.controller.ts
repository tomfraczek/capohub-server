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
  Put,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import {
  assertImageFilePresent,
  imageUploadInterceptor,
} from '../storage/multer-image.interceptor';
import { User } from '../users/entities/user.entity';
import { AddMemberDto, addMemberSchema } from './dto/add-member.schema';
import { BanMemberDto, banMemberSchema } from './dto/ban-member.schema';
import { HierarchyEntityRefDto } from './dto/hierarchy-response.dto';
import {
  SetHierarchyParentDto,
  setHierarchyParentSchema,
} from './dto/set-hierarchy-parent.schema';
import { SectionMembershipResponseDto } from './dto/section-membership-response.dto';
import { SectionResponseDto } from './dto/section-response.dto';
import {
  SuspendMemberDto,
  suspendMemberSchema,
} from './dto/suspend-member.schema';
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
import { HierarchyManagementService } from './hierarchy-management.service';
import { GroupPermission } from './permissions/group-permission.enum';
import { RoleAssignmentsService } from './role-assignments.service';
import { SectionMembershipsService } from './section-memberships.service';
import { SectionsService } from './sections.service';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Single-resource operations on one specific Section, addressed directly by
// id. @RequireGroupKind(GroupKind.SECTION) on every handler here ensures a
// Group id 404s instead of being silently served through this route
// family - a Group is only ever reached via /groups/:id.
//
// Unlike GroupsController, Section has real membership - every
// join/leave/member-list/ban/suspend/cohort-assignment route that used to
// live on GroupsController lives here instead (Group has none of these at
// all - see groups.controller.ts).
@Controller('sections/:sectionId')
@UseGuards(GroupPermissionsGuard)
export class SectionController {
  constructor(
    private readonly sectionsService: SectionsService,
    private readonly sectionMembershipsService: SectionMembershipsService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly hierarchyManagementService: HierarchyManagementService,
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

  // PUT/DELETE profile-image (module: "R2: upload/replace/delete zdjęć"
  // §16/§19) - same GROUP_EDIT gate as update() above, not inherited from
  // the parent Group (module spec §19: "Nie dziedzicz permission z parent
  // Group").
  @Put('profile-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.SECTION)
  @UseInterceptors(imageUploadInterceptor())
  uploadProfileImage(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SectionResponseDto> {
    assertImageFilePresent(file);
    return this.sectionsService.uploadProfileImage(sectionId, file);
  }

  @Delete('profile-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.SECTION)
  deleteProfileImage(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.deleteProfileImage(sectionId);
  }

  // PUT/DELETE cover-image - same shape/gating as the profile-image pair
  // above, just for the cover image (mirrors GroupsController's own
  // cover-image pair).
  @Put('cover-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.SECTION)
  @UseInterceptors(imageUploadInterceptor())
  uploadCoverImage(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<SectionResponseDto> {
    assertImageFilePresent(file);
    return this.sectionsService.uploadCoverImage(sectionId, file);
  }

  @Delete('cover-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.SECTION)
  deleteCoverImage(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<SectionResponseDto> {
    return this.sectionsService.deleteCoverImage(sectionId);
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

  @Post('transfer-ownership')
  @RequireGroupPermission(GroupPermission.GROUP_OWNERSHIP_TRANSFER)
  @RequireGroupKind(GroupKind.SECTION)
  transferOwnership(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(transferOwnershipSchema))
    dto: TransferOwnershipDto,
  ): Promise<TransferOwnershipResponseDto> {
    return this.roleAssignmentsService.transferOwnership(
      sectionId,
      user.id,
      dto.newOwnerUserId,
      user,
    );
  }

  @Post('leave')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  leave(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.sectionMembershipsService.leave(sectionId, user);
  }

  @Get('members')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  listMembers(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionMembershipResponseDto[]> {
    return this.sectionMembershipsService.listMembers(sectionId, user.id);
  }

  @Post('members')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_ADD)
  @RequireGroupKind(GroupKind.SECTION)
  addMember(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body(new ZodValidationPipe(addMemberSchema)) dto: AddMemberDto,
    @CurrentUser() user: User,
  ): Promise<SectionMembershipResponseDto> {
    return this.sectionMembershipsService.addMember(sectionId, dto, user);
  }

  // A membership that has ended remains readable as history - not filtered
  // to ANY_STATUS by accident, this endpoint is meant to serve archived
  // memberships too.
  @Get('members/:membershipId')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  getMembership(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<SectionMembershipResponseDto> {
    return this.sectionMembershipsService.getMembership(
      sectionId,
      membershipId,
      user.id,
    );
  }

  // There is no PATCH .../members/:membershipId to "change the member's
  // role": a member may hold several Roles at once, so there is no longer
  // a single Role to target by this route. Granting/revoking a specific
  // Role always goes through RoleAssignmentsController
  // (/sections/:sectionId/role-assignments/...).
  @Delete('members/:membershipId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_REMOVE)
  @RequireGroupKind(GroupKind.SECTION)
  removeMember(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.sectionMembershipsService.removeMember(
      sectionId,
      membershipId,
      user,
    );
  }

  // Ends the membership (like removeMember) and additionally blocks the
  // user from rejoining/being re-invited until unbanned - see SectionBan.
  @Post('members/:membershipId/ban')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_BAN)
  @RequireGroupKind(GroupKind.SECTION)
  banMember(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(banMemberSchema)) dto: BanMemberDto,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.sectionMembershipsService.banMember(
      sectionId,
      membershipId,
      user,
      dto.reason ?? null,
    );
  }

  // Lifts the ban - does not restore the membership itself, see
  // SectionMembershipsService.unbanMember.
  @Post('members/:membershipId/unban')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_UNBAN)
  @RequireGroupKind(GroupKind.SECTION)
  unbanMember(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    return this.sectionMembershipsService.unbanMember(
      sectionId,
      membershipId,
      user,
    );
  }

  // Sets membership.status to READ_ONLY for a bounded (or indefinite) time
  // window - see MembershipSuspension and SectionMembershipsService. The
  // active OWNER is protected the same as ban/remove/leave - transfer
  // ownership first.
  @Post('members/:membershipId/suspend')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_SUSPEND)
  @RequireGroupKind(GroupKind.SECTION)
  suspendMember(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Body(new ZodValidationPipe(suspendMemberSchema)) dto: SuspendMemberDto,
    @CurrentUser() user: User,
  ): Promise<SectionMembershipResponseDto> {
    return this.sectionMembershipsService.suspendMember(
      sectionId,
      membershipId,
      user,
      dto.until ? new Date(dto.until) : null,
      dto.reason ?? null,
    );
  }

  // Only valid while the membership is currently suspended (READ_ONLY) -
  // enforced in the service, not by @AllowGroupStatuses (that decorator
  // gates the *Section's* status, not the membership's).
  @Post('members/:membershipId/unsuspend')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_UNSUSPEND)
  @RequireGroupKind(GroupKind.SECTION)
  unsuspendMember(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @CurrentUser() user: User,
  ): Promise<SectionMembershipResponseDto> {
    return this.sectionMembershipsService.unsuspendMember(
      sectionId,
      membershipId,
      user,
    );
  }

  @Post('members/:membershipId/cohorts/:cohortId')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_COHORT_ASSIGN)
  @RequireGroupKind(GroupKind.SECTION)
  assignCohort(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
  ): Promise<void> {
    return this.sectionMembershipsService.assignCohort(
      sectionId,
      membershipId,
      cohortId,
    );
  }

  @Delete('members/:membershipId/cohorts/:cohortId')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_COHORT_ASSIGN)
  @RequireGroupKind(GroupKind.SECTION)
  unassignCohort(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Param('membershipId', ParseUUIDPipe) membershipId: string,
    @Param('cohortId', ParseUUIDPipe) cohortId: string,
  ): Promise<void> {
    return this.sectionMembershipsService.unassignCohort(
      sectionId,
      membershipId,
      cohortId,
    );
  }

  // ─── Hierarchy: parent / breadcrumbs ─────────────────────────────────────
  // A Section can never have children (see GroupHierarchyService) - there is
  // no .../children route here.

  @Get('parent')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  getParent(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<HierarchyEntityRefDto | null> {
    return this.hierarchyManagementService.getParent(sectionId);
  }

  @Get('breadcrumbs')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.SECTION)
  @AllowGroupStatuses(...ANY_STATUS)
  getBreadcrumbs(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
  ): Promise<HierarchyEntityRefDto[]> {
    return this.hierarchyManagementService.getBreadcrumbs(sectionId);
  }

  // Attaches (no previous parent) or moves (had a different parent) this
  // Section under :parentGroupId - same primitive either way, see
  // HierarchyManagementService.setSectionParent. Requires HIERARCHY_MANAGE
  // on both this Section and parentGroupId.
  @Post('parent')
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  @RequireGroupKind(GroupKind.SECTION)
  setParent(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @Body(new ZodValidationPipe(setHierarchyParentSchema))
    dto: SetHierarchyParentDto,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.hierarchyManagementService.setSectionParent(
      sectionId,
      dto.parentGroupId,
      user,
    );
  }

  // Detaches this Section from its current parent, leaving it standalone.
  // Never touches membership or Role Assignments.
  @Delete('parent')
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  @RequireGroupKind(GroupKind.SECTION)
  detachParent(
    @Param('sectionId', ParseUUIDPipe) sectionId: string,
    @CurrentUser() user: User,
  ): Promise<SectionResponseDto> {
    return this.hierarchyManagementService.detachSection(sectionId, user);
  }
}
