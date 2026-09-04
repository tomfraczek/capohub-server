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
import { CreateGroupDto, createGroupSchema } from './dto/create-group.schema';
import {
  CreateHierarchyInvitationDto,
  createHierarchyInvitationSchema,
} from './dto/create-hierarchy-invitation.schema';
import { GroupResponseDto } from './dto/group-response.dto';
import { GroupSummaryResponseDto } from './dto/group-summary-response.dto';
import { HierarchyInvitationResponseDto } from './dto/hierarchy-invitation-response.dto';
import { HierarchyEntityRefDto } from './dto/hierarchy-response.dto';
import {
  SetHierarchyParentDto,
  setHierarchyParentSchema,
} from './dto/set-hierarchy-parent.schema';
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
import { HierarchyManagementService } from './hierarchy-management.service';
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
    private readonly hierarchyManagementService: HierarchyManagementService,
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

  // PUT/DELETE :id/profile-image (module: "R2: upload/replace/delete
  // zdjęć" §16/§18) - deliberately separate multipart endpoints, not
  // folded into the JSON PATCH above (module spec §16: "Nie mieszaj
  // multipart z istniejącymi JSON PATCH endpoints"). Same GROUP_EDIT gate
  // and @RequireGroupKind(GroupKind.ROOT) as update() - no new permission.
  @Put(':id/profile-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.ROOT)
  @UseInterceptors(imageUploadInterceptor())
  uploadProfileImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<GroupResponseDto> {
    assertImageFilePresent(file);
    return this.groupsService.uploadProfileImage(id, file);
  }

  @Delete(':id/profile-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.ROOT)
  deleteProfileImage(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GroupResponseDto> {
    return this.groupsService.deleteProfileImage(id);
  }

  // PUT/DELETE :id/cover-image - same shape/gating as the profile-image
  // pair above, just for the cover image.
  @Put(':id/cover-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.ROOT)
  @UseInterceptors(imageUploadInterceptor())
  uploadCoverImage(
    @Param('id', ParseUUIDPipe) id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<GroupResponseDto> {
    assertImageFilePresent(file);
    return this.groupsService.uploadCoverImage(id, file);
  }

  @Delete(':id/cover-image')
  @RequireGroupPermission(GroupPermission.GROUP_EDIT)
  @RequireGroupKind(GroupKind.ROOT)
  deleteCoverImage(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<GroupResponseDto> {
    return this.groupsService.deleteCoverImage(id);
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

  // ─── Hierarchy: parent / children / breadcrumbs ─────────────────────────

  @Get(':id/parent')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  getParent(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HierarchyEntityRefDto | null> {
    return this.hierarchyManagementService.getParent(id);
  }

  // Direct child Groups and direct Sections combined - a Section can never
  // have children, so there is no equivalent route on SectionController.
  @Get(':id/children')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  listChildren(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HierarchyEntityRefDto[]> {
    return this.hierarchyManagementService.listChildren(id);
  }

  @Get(':id/breadcrumbs')
  @RequireGroupPermission(GroupPermission.GROUP_VIEW)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  getBreadcrumbs(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HierarchyEntityRefDto[]> {
    return this.hierarchyManagementService.getBreadcrumbs(id);
  }

  // Attaches (no previous parent) or moves (had a different parent) this
  // Group under :parentGroupId - same primitive either way, see
  // HierarchyManagementService.setGroupParent. Requires HIERARCHY_MANAGE on
  // both this Group and parentGroupId.
  @Post(':id/parent')
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  setParent(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(setHierarchyParentSchema))
    dto: SetHierarchyParentDto,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.hierarchyManagementService.setGroupParent(
      id,
      dto.parentGroupId,
      user,
    );
  }

  // Detaches this Group from its current parent, making it a root Group
  // again. Never touches membership or Role Assignments.
  @Delete(':id/parent')
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  @RequireGroupKind(GroupKind.ROOT)
  detachParent(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: User,
  ): Promise<GroupResponseDto> {
    return this.hierarchyManagementService.detachGroup(id, user);
  }

  // ─── Hierarchy: invitations sent by this Group (parent side) ────────────
  // Only a Group may be the parent side of a hierarchy relationship - see
  // GroupPermission.HIERARCHY_INVITE's own comment - so these routes have no
  // SectionController equivalent.

  @Post(':id/child-invitations')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.HIERARCHY_INVITE)
  @RequireGroupKind(GroupKind.ROOT)
  createChildInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(createHierarchyInvitationSchema))
    dto: CreateHierarchyInvitationDto,
    @CurrentUser() user: User,
  ): Promise<HierarchyInvitationResponseDto> {
    return this.hierarchyManagementService.createInvitation(id, dto, user);
  }

  @Get(':id/child-invitations')
  @RequireGroupPermission(GroupPermission.HIERARCHY_INVITE)
  @RequireGroupKind(GroupKind.ROOT)
  @AllowGroupStatuses(...ANY_STATUS)
  listChildInvitations(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<HierarchyInvitationResponseDto[]> {
    return this.hierarchyManagementService.listSentInvitations(id);
  }

  @Post(':id/child-invitations/:invitationId/cancel')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.HIERARCHY_INVITE)
  @RequireGroupKind(GroupKind.ROOT)
  async cancelChildInvitation(
    @Param('id', ParseUUIDPipe) id: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.hierarchyManagementService.cancelInvitation(
      id,
      invitationId,
      user,
    );
  }
}
