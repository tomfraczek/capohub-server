import {
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { User } from '../users/entities/user.entity';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { HierarchyInvitationResponseDto } from './dto/hierarchy-invitation-response.dto';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { HierarchyManagementService } from './hierarchy-management.service';
import { GroupPermission } from './permissions/group-permission.enum';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

// Target-side (child) actions on a HierarchyInvitation - listing what was
// received, and accepting/rejecting it. Dual-mounted like
// MembershipRequestsController, since the target may be a Group or a
// Section. Only the target's own OWNER may act here (HIERARCHY_MANAGE) -
// see hierarchy-management.service.ts's own comment on why this is
// stricter than a plain ADMIN capability. Sending/listing/cancelling an
// invitation from the *parent* side lives on GroupsController instead
// (only a Group may be a parent).
@Controller(['groups/:groupId', 'sections/:sectionId'])
@UseGuards(GroupPermissionsGuard)
export class HierarchyInvitationsController {
  constructor(
    private readonly hierarchyManagementService: HierarchyManagementService,
  ) {}

  @Get('hierarchy-invitations/received')
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  @AllowGroupStatuses(...ANY_STATUS)
  listReceived(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<HierarchyInvitationResponseDto[]> {
    return this.hierarchyManagementService.listReceivedInvitations(
      groupId ?? sectionId,
    );
  }

  @Post('hierarchy-invitations/:invitationId/accept')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  async accept(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.hierarchyManagementService.acceptInvitation(
      groupId ?? sectionId,
      invitationId,
      user,
    );
  }

  @Post('hierarchy-invitations/:invitationId/reject')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.HIERARCHY_MANAGE)
  async reject(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.hierarchyManagementService.rejectInvitation(
      groupId ?? sectionId,
      invitationId,
      user,
    );
  }
}
