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
  CreateInvitationDto,
  createInvitationSchema,
} from './dto/create-invitation.schema';
import { JoinGroupDto, joinGroupSchema } from './dto/join-group.schema';
import { MembershipRequestResponseDto } from './dto/membership-request-response.dto';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { RequireGroupPermission } from './decorators/require-group-permission.decorator';
import { AllowGroupStatuses } from './decorators/allow-group-statuses.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipRequestsService } from './membership-requests.service';
import { RoleAssignmentsService } from './role-assignments.service';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';

const ANY_STATUS = [
  GroupStatus.ACTIVE,
  GroupStatus.READ_ONLY,
  GroupStatus.ARCHIVED,
  GroupStatus.DELETED,
] as const;

/**
 * Handles the invitation and join-request flows nested under a Group or a
 * Section (dual-mounted: an invitation/join-request may target either
 * level directly - see MembershipRequest.targetType and
 * MembershipRequestsService.join).
 *
 * Authorization is performed at two levels:
 *  1. GroupPermissionsGuard reads the caller's Role Assignment(s) for the
 *     exact entity identified by :groupId/:sectionId.
 *  2. MembershipRequestsService enforces the business rules that the guard
 *     cannot express statically (e.g. MEMBER invites only when
 *     Group.memberInvitesAllowed = true).
 *
 * Group-ownership does NOT grant any permissions in a Section - this is
 * enforced because the guard always resolves authorization against the
 * exact :groupId/:sectionId param, never a parent.
 */
@Controller(['groups/:groupId', 'sections/:sectionId'])
@UseGuards(GroupPermissionsGuard)
export class MembershipRequestsController {
  constructor(
    private readonly membershipRequestsService: MembershipRequestsService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  // ─── JOIN ──────────────────────────────────────────────────────────────────

  /**
   * POST /groups/:groupId/join or POST /sections/:sectionId/join
   *
   * Body: { targetType: 'GROUP' | 'SECTION' }  — required, no default.
   *
   * Any authenticated user may call this.  If the target is public, returns
   * `{ joined: true }`.  If private (isPublic = false), creates a JOIN_REQUEST.
   * If the target is isHidden = true that does not block this endpoint;
   * hidden means "not discoverable via search", not "unjoinable".
   *
   * targetType is mandatory.  Omitting it or supplying an invalid value
   * returns 400 Bad Request.  The backend never infers the caller's intent.
   */
  @Post('join')
  @HttpCode(200)
  async join(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(joinGroupSchema)) dto: JoinGroupDto,
    @CurrentUser() user: User,
  ): Promise<{ joined: true } | MembershipRequestResponseDto> {
    return this.membershipRequestsService.join(
      groupId ?? sectionId,
      dto.targetType,
      user,
    );
  }

  /**
   * DELETE /groups/:groupId/join-requests/mine (or /sections/:sectionId/...)
   *
   * Withdraw the caller's own PENDING JOIN_REQUEST for this target.
   */
  @Delete('join-requests/mine')
  @HttpCode(204)
  async withdrawJoinRequest(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    // We look up the pending request by target id + user in the service
    await this.membershipRequestsService.withdrawMyJoinRequest(
      groupId ?? sectionId,
      user,
    );
  }

  // ─── INVITATIONS (target admin view) ──────────────────────────────────────

  /**
   * POST /groups/:groupId/invitations (or /sections/:sectionId/...)
   *
   * Create an Invitation for this target.
   * Guard: GROUP_INVITE (MEMBER + ADMIN + OWNER all have it; service enforces
   * memberInvitesAllowed for plain MEMBERs).
   */
  @Post('invitations')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.GROUP_INVITE)
  async createInvitation(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Body(new ZodValidationPipe(createInvitationSchema))
    dto: CreateInvitationDto,
    @CurrentUser() user: User,
  ): Promise<MembershipRequestResponseDto> {
    const targetId = groupId ?? sectionId;
    const { roles, membershipStatus } = await this.resolveCallerContext(
      targetId,
      user.id,
    );
    return this.membershipRequestsService.createInvitation(
      targetId,
      dto,
      user,
      roles,
      membershipStatus,
    );
  }

  /**
   * GET /groups/:groupId/invitations (or /sections/:sectionId/...)
   *
   * List all PENDING invitations sent for this target (admin view).
   */
  @Get('invitations')
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  async listInvitations(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<MembershipRequestResponseDto[]> {
    return this.membershipRequestsService.listInvitationsForGroup(
      groupId ?? sectionId,
    );
  }

  /**
   * POST /groups/:groupId/invitations/:invitationId/cancel (or /sections/...)
   *
   * Cancel a PENDING Invitation.  The service enforces that only the
   * original inviter (initiatedBy), ADMIN, or OWNER of the target may
   * cancel.  A plain MEMBER cannot cancel an invitation that was created by
   * someone else.  The guard gate (MEMBERSHIP_VIEW) is intentionally the
   * lowest permission so that all roles reach the service; the finer check
   * is done there using the resolved roles passed from this method.
   */
  @Post('invitations/:invitationId/cancel')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.MEMBERSHIP_VIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  async cancelInvitation(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    const { roles } = await this.resolveCallerContext(
      groupId ?? sectionId,
      user.id,
    );
    await this.membershipRequestsService.cancelInvitation(
      invitationId,
      user,
      roles,
    );
  }

  /**
   * POST /groups/:groupId/invitations/:invitationId/resend (or /sections/...)
   *
   * Cancel the existing PENDING Invitation and create a fresh one.
   */
  @Post('invitations/:invitationId/resend')
  @HttpCode(201)
  @RequireGroupPermission(GroupPermission.GROUP_INVITE)
  async resendInvitation(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
    @Param('invitationId', ParseUUIDPipe) invitationId: string,
    @CurrentUser() user: User,
  ): Promise<MembershipRequestResponseDto> {
    const { roles, membershipStatus } = await this.resolveCallerContext(
      groupId ?? sectionId,
      user.id,
    );
    return this.membershipRequestsService.resendInvitation(
      invitationId,
      user,
      roles,
      membershipStatus,
    );
  }

  // ─── JOIN REQUESTS (admin view) ────────────────────────────────────────────

  /**
   * GET /groups/:groupId/join-requests (or /sections/:sectionId/...)
   *
   * List all PENDING join requests for this target.
   */
  @Get('join-requests')
  @RequireGroupPermission(GroupPermission.GROUP_JOIN_REQUEST_REVIEW)
  @AllowGroupStatuses(...ANY_STATUS)
  async listJoinRequests(
    @Param('groupId') groupId: string,
    @Param('sectionId') sectionId: string,
  ): Promise<MembershipRequestResponseDto[]> {
    return this.membershipRequestsService.listJoinRequestsForGroup(
      groupId ?? sectionId,
    );
  }

  /**
   * POST /groups/:groupId/join-requests/:requestId/approve (or /sections/...)
   */
  @Post('join-requests/:requestId/approve')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.GROUP_JOIN_REQUEST_REVIEW)
  async approveJoinRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.membershipRequestsService.approveJoinRequest(requestId, user);
  }

  /**
   * POST /groups/:groupId/join-requests/:requestId/reject (or /sections/...)
   */
  @Post('join-requests/:requestId/reject')
  @HttpCode(204)
  @RequireGroupPermission(GroupPermission.GROUP_JOIN_REQUEST_REVIEW)
  async rejectJoinRequest(
    @Param('requestId', ParseUUIDPipe) requestId: string,
    @CurrentUser() user: User,
  ): Promise<void> {
    await this.membershipRequestsService.rejectJoinRequest(requestId, user);
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /**
   * Reads the caller's current Role Assignments for targetId so the service
   * can apply the memberInvitesAllowed business rule without a second DB
   * round-trip for the guard's result.
   */
  private async resolveCallerContext(
    targetId: string,
    userId: string,
  ): Promise<{ roles: GroupRole[]; membershipStatus: GroupMembershipStatus }> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(targetId, userId);
    if (!authorization) {
      return { roles: [], membershipStatus: GroupMembershipStatus.ARCHIVED };
    }
    return {
      roles: authorization.roleAssignments.map((ra) => ra.role),
      membershipStatus: authorization.membership.status,
    };
  }
}
