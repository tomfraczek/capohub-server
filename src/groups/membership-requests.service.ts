import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { CreateInvitationInput } from './dto/create-invitation.schema';
import { MembershipRequestResponseDto } from './dto/membership-request-response.dto';
import { Group } from './entities/group.entity';
import { GroupMembership } from './entities/group-membership.entity';
import {
  MEMBERSHIP_REQUEST_PENDING_EMAIL_IDX,
  MEMBERSHIP_REQUEST_PENDING_JOIN_IDX,
  MEMBERSHIP_REQUEST_PENDING_USER_IDX,
  MembershipRequest,
} from './entities/membership-request.entity';
import { GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX } from './entities/group-membership.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipRequestStatus } from './enums/membership-request-status.enum';
import { MembershipRequestTarget } from './enums/membership-request-target.enum';
import { MembershipRequestType } from './enums/membership-request-type.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { loadActiveMembership } from './group-membership.query';
import { RoleAssignmentsService } from './role-assignments.service';

/**
 * Handles the full lifecycle of invitations and join requests for both
 * Organizations (Root Groups) and specific Groups.
 *
 * Key domain invariants enforced here:
 *  - Organization ownership does NOT grant any permissions in its Child Groups.
 *  - Accepting an ORGANIZATION-level request creates only a Membership; no
 *    RoleAssignment is created anywhere.
 *  - Accepting a GROUP-level request ensures Membership in the Root Group AND
 *    grants MEMBER in the exact targetGroup only.
 *  - Accepting is idempotent: duplicate Membership or duplicate MEMBER Role is
 *    treated as ALREADY_MEMBER / ALREADY_GROUP_MEMBER (not silently duplicated).
 *  - Terminal requests (ACCEPTED/REJECTED/CANCELLED) cannot be re-processed.
 */
@Injectable()
export class MembershipRequestsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  // ─── JOIN (auto-join or join request based on isPublic) ──────────────────

  /**
   * "Join" button pressed by the authenticated user.
   *
   * - isPublic = true  → immediately creates Membership / MEMBER Role.
   * - isPublic = false → creates a PENDING JOIN_REQUEST.
   *
   * isHidden has NO effect here.  A hidden Group is simply one that does not
   * appear in discovery searches — it is still joinable via a direct link,
   * publicCode, or QR code.  Being hidden and private (isPublic=false)
   * together means the Group is invite-only but still reachable by code.
   *
   * targetType decides the acceptance effect (Membership only vs
   * Membership + MEMBER Role).  It is required — the backend never infers
   * the caller's intent.  If omitted or invalid the ZodValidationPipe
   * returns 400 before this method is called.
   *
   * The ORGANIZATION path requires targetGroup to be a Root Group.
   */
  async join(
    targetGroupId: string,
    targetType: MembershipRequestTarget,
    requestingUser: User,
  ): Promise<MembershipRequestResponseDto | { joined: true }> {
    return this.em.transactional(async (em) => {
      const targetGroup = await this.loadActiveGroupOrFail(em, targetGroupId);

      if (targetType === MembershipRequestTarget.ORGANIZATION) {
        this.assertIsRootGroup(targetGroup);
      }

      // Check if already a member (organization or group level)
      await this.assertNotAlreadyJoined(
        em,
        targetGroup,
        targetType,
        requestingUser,
      );

      if (targetGroup.isPublic) {
        // Auto-join path
        await this.fulfillJoin(em, targetGroup, targetType, requestingUser);
        return { joined: true };
      } else {
        // Create JOIN_REQUEST
        const request = new MembershipRequest();
        request.type = MembershipRequestType.JOIN_REQUEST;
        request.targetType = targetType;
        request.targetGroup = targetGroup;
        request.initiatedBy = requestingUser;

        try {
          em.persist(request);
          await em.flush();
        } catch (error) {
          if (isUniqueViolationOn(error, MEMBERSHIP_REQUEST_PENDING_JOIN_IDX)) {
            throw new ConflictException({
              code: 'JOIN_REQUEST_ALREADY_PENDING',
              message: 'You already have a pending join request for this group',
            });
          }
          throw error;
        }

        return toMembershipRequestResponseDto(request);
      }
    });
  }

  /**
   * Withdraw the caller's own PENDING JOIN_REQUEST for a specific group.
   * Looks up the PENDING request by targetGroup + initiatedBy.
   */
  async withdrawMyJoinRequest(
    targetGroupId: string,
    requestingUser: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(MembershipRequest, {
        targetGroup: targetGroupId,
        initiatedBy: requestingUser.id,
        type: MembershipRequestType.JOIN_REQUEST,
        status: MembershipRequestStatus.PENDING,
      });
      if (!request) {
        throw new NotFoundException({
          code: 'JOIN_REQUEST_NOT_FOUND',
          message: 'No pending join request found for this group',
        });
      }

      request.status = MembershipRequestStatus.CANCELLED;
      request.processedAt = new Date();
      request.processedBy = requestingUser;
      await em.flush();
    });
  }

  /**
   * Withdraw the caller's own PENDING JOIN_REQUEST by request ID.
   */
  async withdrawJoinRequest(
    requestId: string,
    requestingUser: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(MembershipRequest, { id: requestId });
      if (!request) {
        throw this.requestNotFound();
      }
      if (request.initiatedBy.id !== requestingUser.id) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_JOIN_REQUEST',
          message: 'You can only withdraw your own join requests',
        });
      }
      if (request.type !== MembershipRequestType.JOIN_REQUEST) {
        throw new UnprocessableEntityException({
          code: 'NOT_A_JOIN_REQUEST',
          message: 'This request is an invitation, not a join request',
        });
      }
      this.assertPending(request);

      request.status = MembershipRequestStatus.CANCELLED;
      request.processedAt = new Date();
      request.processedBy = requestingUser;
      await em.flush();
    });
  }

  // ─── INVITATIONS ─────────────────────────────────────────────────────────

  /**
   * Create an Invitation.  Authorization is pre-checked by the caller
   * (GroupPermissionsGuard for GROUP_INVITE + service-level
   * memberInvitesAllowed check for MEMBER callers).
   *
   * The `callerRoles` array is needed to enforce that MEMBER may only invite
   * when Group.memberInvitesAllowed is true; ADMIN and OWNER bypass that
   * setting entirely.
   */
  async createInvitation(
    targetGroupId: string,
    input: CreateInvitationInput,
    inviter: User,
    callerRoles: GroupRole[],
    callerMembershipStatus: GroupMembershipStatus,
  ): Promise<MembershipRequestResponseDto> {
    return this.em.transactional(async (em) => {
      const targetGroup = await this.loadActiveGroupOrFail(em, targetGroupId);

      if (input.targetType === MembershipRequestTarget.ORGANIZATION) {
        this.assertIsRootGroup(targetGroup);
        // For organization-level invitations the caller needs MEMBERSHIP_INVITE,
        // which only ADMIN/OWNER have.  Guard already enforced it, but we
        // double-check the targetType matches the guard's expectation.
      } else {
        // GROUP-level invitation: check memberInvitesAllowed for plain MEMBERs
        this.assertCanInviteToGroup(
          targetGroup,
          callerRoles,
          callerMembershipStatus,
        );
      }

      // Validate input: exactly one of invitedUserId / invitedEmail
      if (!input.invitedUserId && !input.invitedEmail) {
        throw new UnprocessableEntityException({
          code: 'INVITATION_RECIPIENT_REQUIRED',
          message: 'Provide either invitedUserId or invitedEmail',
        });
      }
      if (input.invitedUserId && input.invitedEmail) {
        throw new UnprocessableEntityException({
          code: 'INVITATION_RECIPIENT_AMBIGUOUS',
          message: 'Provide either invitedUserId or invitedEmail, not both',
        });
      }

      let invitedUser: User | null = null;
      let invitedEmail: string | null = null;

      if (input.invitedUserId) {
        const found = await em.findOne(User, { id: input.invitedUserId });
        if (!found) {
          throw new NotFoundException({
            code: 'INVITED_USER_NOT_FOUND',
            message: 'No user exists with the given invitedUserId',
          });
        }
        invitedUser = found;

        // Already a member?
        await this.assertNotAlreadyJoined(
          em,
          targetGroup,
          input.targetType,
          invitedUser,
        );
      } else {
        invitedEmail = input.invitedEmail!;

        // Check if a user with this email already has an account
        const existing = await em.findOne(User, { email: invitedEmail });
        if (existing) {
          invitedUser = existing;
          invitedEmail = null; // treat as user-based invitation
          await this.assertNotAlreadyJoined(
            em,
            targetGroup,
            input.targetType,
            invitedUser,
          );
        }
      }

      const request = new MembershipRequest();
      request.type = MembershipRequestType.INVITATION;
      request.targetType = input.targetType;
      request.targetGroup = targetGroup;
      request.initiatedBy = inviter;
      request.invitedUser = invitedUser;
      request.invitedEmail = invitedEmail;

      try {
        em.persist(request);
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, MEMBERSHIP_REQUEST_PENDING_USER_IDX) ||
          isUniqueViolationOn(error, MEMBERSHIP_REQUEST_PENDING_EMAIL_IDX)
        ) {
          throw new ConflictException({
            code: 'INVITATION_ALREADY_PENDING',
            message:
              'A pending invitation for this recipient already exists for this group',
          });
        }
        throw error;
      }

      return toMembershipRequestResponseDto(request);
    });
  }

  /**
   * Cancel a PENDING Invitation.
   *
   * Only three principals may cancel:
   *   1. The original inviter (initiatedBy) — regardless of their current
   *      role, they always own the invitation they sent.
   *   2. ADMIN of the target Group — can clean up any invitation for their
   *      Group.
   *   3. OWNER of the target Group — same as ADMIN, always allowed.
   *
   * A plain MEMBER (who is NOT the inviter) cannot cancel someone else's
   * invitation even if Group.memberInvitesAllowed is true.
   *
   * `callerRoles` must be the resolved Role Assignments of `actor` in the
   * target Group, supplied by the controller via resolveCallerContext().
   */
  async cancelInvitation(
    requestId: string,
    actor: User,
    callerRoles: GroupRole[],
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await this.loadRequestByIdOrFail(em, requestId);
      if (request.type !== MembershipRequestType.INVITATION) {
        throw new UnprocessableEntityException({
          code: 'NOT_AN_INVITATION',
          message: 'This request is not an invitation',
        });
      }
      this.assertPending(request);

      const isInviter = request.initiatedBy.id === actor.id;
      const isAdminOrOwner = callerRoles.some(
        (r) => r === GroupRole.ADMIN || r === GroupRole.OWNER,
      );
      if (!isInviter && !isAdminOrOwner) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_PERMISSIONS_TO_CANCEL_INVITATION',
          message:
            'Only the original inviter, ADMIN, or OWNER may cancel an invitation',
        });
      }

      request.status = MembershipRequestStatus.CANCELLED;
      request.processedAt = new Date();
      request.processedBy = actor;
      await em.flush();
    });
  }

  /**
   * Resend: cancel the existing PENDING Invitation and create a fresh one.
   * Returns the new invitation.
   */
  async resendInvitation(
    requestId: string,
    actor: User,
    callerRoles: GroupRole[],
    callerMembershipStatus: GroupMembershipStatus,
  ): Promise<MembershipRequestResponseDto> {
    return this.em.transactional(async (em) => {
      const existing = await this.loadRequestByIdOrFail(em, requestId);
      if (existing.type !== MembershipRequestType.INVITATION) {
        throw new UnprocessableEntityException({
          code: 'NOT_AN_INVITATION',
          message: 'This request is not an invitation',
        });
      }
      this.assertPending(existing);

      // Cancel old
      existing.status = MembershipRequestStatus.CANCELLED;
      existing.processedAt = new Date();
      existing.processedBy = actor;

      // Create new with same parameters
      const fresh = new MembershipRequest();
      fresh.type = MembershipRequestType.INVITATION;
      fresh.targetType = existing.targetType;
      fresh.targetGroup = existing.targetGroup;
      fresh.initiatedBy = actor;
      fresh.invitedUser = existing.invitedUser;
      fresh.invitedEmail = existing.invitedEmail;

      em.persist(fresh);
      await em.flush();

      return toMembershipRequestResponseDto(fresh);
    });
  }

  // ─── ACCEPT / REJECT (by the invitee) ────────────────────────────────────

  /**
   * The invitee accepts their PENDING INVITATION.
   *
   * For ORGANIZATION target: creates/reactivates a Membership only.
   * For GROUP target: ensures Membership in Root Group AND grants MEMBER.
   *
   * Idempotent at the Membership/Role level: if the invitee is somehow
   * already an active member (e.g. accepted through a different path
   * concurrently), a ConflictException is thrown rather than creating a
   * duplicate.
   */
  async acceptInvitation(
    requestId: string,
    acceptingUser: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(
        MembershipRequest,
        { id: requestId },
        {
          populate: ['targetGroup', 'invitedUser', 'initiatedBy'],
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );
      if (!request) throw this.requestNotFound();

      if (request.type !== MembershipRequestType.INVITATION) {
        throw new UnprocessableEntityException({
          code: 'NOT_AN_INVITATION',
          message: 'This request is not an invitation',
        });
      }
      this.assertPending(request);

      // Ensure this user is the recipient
      const isRecipient =
        (request.invitedUser && request.invitedUser.id === acceptingUser.id) ||
        (request.invitedEmail && request.invitedEmail === acceptingUser.email);
      if (!isRecipient) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_INVITATION',
          message: 'This invitation was not sent to you',
        });
      }

      await this.fulfillJoin(
        em,
        request.targetGroup,
        request.targetType,
        acceptingUser,
      );

      request.status = MembershipRequestStatus.ACCEPTED;
      request.processedAt = new Date();
      request.processedBy = acceptingUser;
      await em.flush();
    });
  }

  /**
   * The invitee rejects their PENDING INVITATION.
   */
  async rejectInvitation(
    requestId: string,
    rejectingUser: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(
        MembershipRequest,
        { id: requestId },
        { populate: ['invitedUser'] },
      );
      if (!request) throw this.requestNotFound();

      if (request.type !== MembershipRequestType.INVITATION) {
        throw new UnprocessableEntityException({
          code: 'NOT_AN_INVITATION',
          message: 'This request is not an invitation',
        });
      }
      this.assertPending(request);

      const isRecipient =
        (request.invitedUser && request.invitedUser.id === rejectingUser.id) ||
        (request.invitedEmail && request.invitedEmail === rejectingUser.email);
      if (!isRecipient) {
        throw new ForbiddenException({
          code: 'NOT_YOUR_INVITATION',
          message: 'This invitation was not sent to you',
        });
      }

      request.status = MembershipRequestStatus.REJECTED;
      request.processedAt = new Date();
      request.processedBy = rejectingUser;
      await em.flush();
    });
  }

  // ─── APPROVE / REJECT (by ADMIN/OWNER) ───────────────────────────────────

  /**
   * Approve a PENDING JOIN_REQUEST.  Authorization guard already confirmed
   * the actor has GROUP_JOIN_REQUEST_REVIEW / MEMBERSHIP_REQUEST_REVIEW.
   */
  async approveJoinRequest(requestId: string, actor: User): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(
        MembershipRequest,
        { id: requestId },
        {
          populate: ['targetGroup', 'initiatedBy'],
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );
      if (!request) throw this.requestNotFound();

      if (request.type !== MembershipRequestType.JOIN_REQUEST) {
        throw new UnprocessableEntityException({
          code: 'NOT_A_JOIN_REQUEST',
          message: 'This request is not a join request',
        });
      }
      this.assertPending(request);

      await this.fulfillJoin(
        em,
        request.targetGroup,
        request.targetType,
        request.initiatedBy,
      );

      request.status = MembershipRequestStatus.ACCEPTED;
      request.processedAt = new Date();
      request.processedBy = actor;
      await em.flush();
    });
  }

  /**
   * Reject a PENDING JOIN_REQUEST.
   */
  async rejectJoinRequest(requestId: string, actor: User): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(MembershipRequest, { id: requestId });
      if (!request) throw this.requestNotFound();

      if (request.type !== MembershipRequestType.JOIN_REQUEST) {
        throw new UnprocessableEntityException({
          code: 'NOT_A_JOIN_REQUEST',
          message: 'This request is not a join request',
        });
      }
      this.assertPending(request);

      request.status = MembershipRequestStatus.REJECTED;
      request.processedAt = new Date();
      request.processedBy = actor;
      await em.flush();
    });
  }

  // ─── LIST ─────────────────────────────────────────────────────────────────

  /** All PENDING invitations where the current user is the invitee. */
  async listReceivedInvitations(
    user: User,
  ): Promise<MembershipRequestResponseDto[]> {
    const requests = await this.em.find(
      MembershipRequest,
      {
        $or: [{ invitedUser: user.id }, { invitedEmail: user.email }],
        type: MembershipRequestType.INVITATION,
        status: MembershipRequestStatus.PENDING,
      },
      {
        populate: ['targetGroup', 'initiatedBy', 'invitedUser', 'processedBy'],
      },
    );
    return requests.map(toMembershipRequestResponseDto);
  }

  /** All invitations sent for a specific target group (managed view). */
  async listInvitationsForGroup(
    targetGroupId: string,
  ): Promise<MembershipRequestResponseDto[]> {
    const requests = await this.em.find(
      MembershipRequest,
      {
        targetGroup: targetGroupId,
        type: MembershipRequestType.INVITATION,
        status: MembershipRequestStatus.PENDING,
      },
      {
        populate: ['initiatedBy', 'invitedUser', 'processedBy', 'targetGroup'],
      },
    );
    return requests.map(toMembershipRequestResponseDto);
  }

  /** All PENDING join requests for a target group (admin view). */
  async listJoinRequestsForGroup(
    targetGroupId: string,
  ): Promise<MembershipRequestResponseDto[]> {
    const requests = await this.em.find(
      MembershipRequest,
      {
        targetGroup: targetGroupId,
        type: MembershipRequestType.JOIN_REQUEST,
        status: MembershipRequestStatus.PENDING,
      },
      { populate: ['initiatedBy', 'processedBy', 'targetGroup'] },
    );
    return requests.map(toMembershipRequestResponseDto);
  }

  /**
   * Batch version of listJoinRequestsForGroup - all PENDING join requests
   * across several target groups in one query, avoiding N+1 when a caller
   * (e.g. Community Home) already knows which groups it has review
   * permission for. Returns every matching request; capping/pagination is
   * the caller's responsibility.
   */
  async listJoinRequestsForGroups(
    targetGroupIds: string[],
  ): Promise<MembershipRequestResponseDto[]> {
    if (targetGroupIds.length === 0) {
      return [];
    }
    const requests = await this.em.find(
      MembershipRequest,
      {
        targetGroup: { $in: targetGroupIds },
        type: MembershipRequestType.JOIN_REQUEST,
        status: MembershipRequestStatus.PENDING,
      },
      { populate: ['initiatedBy', 'processedBy', 'targetGroup'] },
    );
    return requests.map(toMembershipRequestResponseDto);
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Creates or reactivates membership for an auto-join or accepted request.
   *
   * ORGANIZATION target: only creates a Membership (no Role anywhere).
   * GROUP target: ensures Membership in Root Group + MEMBER Role in targetGroup.
   */
  private async fulfillJoin(
    em: EntityManager,
    targetGroup: Group,
    targetType: MembershipRequestTarget,
    user: User,
  ): Promise<void> {
    const rootGroup =
      targetGroup.parentGroup === null
        ? targetGroup
        : await this.groupHierarchyService.getRootGroup(targetGroup.id, em);

    // Ensure Membership in Root Group
    let membership = await loadActiveMembership(em, rootGroup.id, user.id);
    if (!membership) {
      // Check for ALREADY_MEMBER before creating to surface a clean error
      // (also guarded by the partial unique index).
      membership = new GroupMembership();
      membership.rootGroup = rootGroup;
      membership.user = user;
      membership.joinedAt = new Date();

      try {
        em.persist(membership);
        await em.flush();
      } catch (error) {
        if (isUniqueViolationOn(error, GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX)) {
          // Re-read the now-committed membership
          const existing = await loadActiveMembership(
            em,
            rootGroup.id,
            user.id,
          );
          if (existing) {
            membership = existing;
          } else {
            throw error;
          }
        } else {
          throw error;
        }
      }
    }

    if (targetType === MembershipRequestTarget.ORGANIZATION) {
      // Organization invitation/join: no Role is granted (see ADR-004).
      return;
    }

    // GROUP target: grant MEMBER in the exact targetGroup
    await this.roleAssignmentsService.ensureMemberRole(
      em,
      membership,
      targetGroup,
    );
  }

  /**
   * Throws if the user is already a member of the target (at the correct
   * level - Membership for ORGANIZATION, MEMBER Role for GROUP).
   */
  private async assertNotAlreadyJoined(
    em: EntityManager,
    targetGroup: Group,
    targetType: MembershipRequestTarget,
    user: User,
  ): Promise<void> {
    const rootGroup =
      targetGroup.parentGroup === null
        ? targetGroup
        : await this.groupHierarchyService.getRootGroup(targetGroup.id, em);

    const membership = await loadActiveMembership(em, rootGroup.id, user.id);

    if (targetType === MembershipRequestTarget.ORGANIZATION) {
      if (membership) {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          message: 'You are already a member of this organization',
        });
      }
    } else {
      // GROUP: check MEMBER Role Assignment in the specific group
      if (membership) {
        const memberRole = await em.findOne(RoleAssignment, {
          membership: membership.id,
          group: targetGroup.id,
          role: GroupRole.MEMBER,
        });
        if (memberRole) {
          throw new ConflictException({
            code: 'ALREADY_GROUP_MEMBER',
            message: 'You are already a member of this group',
          });
        }
      }
    }
  }

  /** Enforces that a MEMBER may only invite when memberInvitesAllowed=true. */
  private assertCanInviteToGroup(
    targetGroup: Group,
    callerRoles: GroupRole[],
    callerMembershipStatus: GroupMembershipStatus,
  ): void {
    const hasAdminOrOwner = callerRoles.some(
      (r) => r === GroupRole.ADMIN || r === GroupRole.OWNER,
    );
    if (hasAdminOrOwner) return; // ADMIN/OWNER always allowed

    // MEMBER (or INSTRUCTOR/ASSISTANT) path - require setting
    if (!targetGroup.memberInvitesAllowed) {
      throw new ForbiddenException({
        code: 'MEMBER_INVITES_NOT_ALLOWED',
        message:
          'Member invitations are disabled for this group; only ADMIN and OWNER may invite',
      });
    }
    if (callerMembershipStatus !== GroupMembershipStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'MEMBERSHIP_NOT_ACTIVE',
        message: 'Only active members may send invitations',
      });
    }
  }

  private assertIsRootGroup(group: Group): void {
    if (group.parentGroup !== null) {
      throw new UnprocessableEntityException({
        code: 'NOT_A_ROOT_GROUP',
        message:
          'Organization-level invitations and join requests require a Root Group as target',
      });
    }
  }

  private assertPending(request: MembershipRequest): void {
    if (request.status !== MembershipRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'REQUEST_NOT_PENDING',
        message: `This request is already ${request.status.toLowerCase()} and cannot be processed again`,
      });
    }
  }

  private async loadActiveGroupOrFail(
    em: EntityManager,
    groupId: string,
  ): Promise<Group> {
    const group = await em.findOne(Group, { id: groupId });
    if (!group) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }
    if (group.status === GroupStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'GROUP_ARCHIVED',
        message: 'This group is archived and is read-only until it is restored',
      });
    }
    return group;
  }

  private async loadRequestByIdOrFail(
    em: EntityManager,
    requestId: string,
  ): Promise<MembershipRequest> {
    const request = await em.findOne(
      MembershipRequest,
      { id: requestId },
      {
        populate: ['targetGroup', 'initiatedBy', 'invitedUser', 'processedBy'],
      },
    );
    if (!request) throw this.requestNotFound();
    return request;
  }

  private requestNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEMBERSHIP_REQUEST_NOT_FOUND',
      message: 'Membership request not found',
    });
  }
}

// ─── Mapper ───────────────────────────────────────────────────────────────────

export function toMembershipRequestResponseDto(
  request: MembershipRequest,
): MembershipRequestResponseDto {
  return {
    id: request.id,
    type: request.type,
    targetType: request.targetType,
    targetGroupId: request.targetGroup.id,
    status: request.status,
    initiatedBy: {
      id: request.initiatedBy.id,
      displayName: request.initiatedBy.displayName,
    },
    invitedUser: request.invitedUser
      ? {
          id: request.invitedUser.id,
          displayName: request.invitedUser.displayName,
        }
      : null,
    invitedEmail: request.invitedEmail,
    processedAt: request.processedAt ? request.processedAt.toISOString() : null,
    processedBy: request.processedBy
      ? {
          id: request.processedBy.id,
          displayName: request.processedBy.displayName,
        }
      : null,
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}
