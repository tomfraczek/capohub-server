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
import { NotificationCategory } from '../notifications/enums/notification-category.enum';
import { NotificationTargetType } from '../notifications/enums/notification-target-type.enum';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  groupJoinRequestApprovedText,
  groupJoinRequestReceivedText,
  groupJoinRequestRejectedText,
  sectionInvitationAcceptedText,
  sectionInvitationReceivedText,
  sectionInvitationRejectedText,
  sectionJoinRequestApprovedText,
  sectionJoinRequestReceivedText,
  sectionJoinRequestRejectedText,
} from '../notifications/notification-text.util';
import {
  CreateNotificationParams,
  NotificationsService,
} from '../notifications/notifications.service';
import {
  PublicUrlBuilder,
  resolveUserAvatarUrl,
} from '../storage/image-url.util';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { CreateInvitationInput } from './dto/create-invitation.schema';
import { MembershipRequestResponseDto } from './dto/membership-request-response.dto';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { Group } from './entities/group.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { SectionBan } from './entities/section-ban.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import {
  MEMBERSHIP_REQUEST_PENDING_EMAIL_IDX,
  MEMBERSHIP_REQUEST_PENDING_JOIN_IDX,
  MEMBERSHIP_REQUEST_PENDING_USER_IDX,
  MembershipRequest,
} from './entities/membership-request.entity';
import { SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX } from './entities/section-membership.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipRequestStatus } from './enums/membership-request-status.enum';
import { MembershipRequestTarget } from './enums/membership-request-target.enum';
import { MembershipRequestType } from './enums/membership-request-type.enum';
import { Community, communityIdFilter } from './group-hierarchy.service';
import {
  cancelPendingGroupJoinRequests,
  switchFormalGroup,
} from './formal-group-switch';
import { loadActiveSectionMembership } from './section-membership.query';
import { RoleAssignmentsService } from './role-assignments.service';

// The Group-or-Section a MembershipRequest targets, whichever of
// targetGroup/targetSection is actually set (see membership-request.entity.ts).
function requestTarget(request: MembershipRequest): Community {
  return (request.targetGroup ?? request.targetSection)!;
}

function assignTarget(request: MembershipRequest, community: Community): void {
  if (community instanceof Section) {
    request.targetSection = community;
    request.targetGroup = null;
  } else {
    request.targetGroup = community;
    request.targetSection = null;
  }
}

function groupHasNoMembership(): UnprocessableEntityException {
  return new UnprocessableEntityException({
    code: 'GROUP_HAS_NO_MEMBERSHIP',
    message:
      'A Group has no membership and no join/invitation flow - it is administered exclusively through RoleAssignments (grantRole for ADMIN, transferOwnership for OWNER)',
  });
}

/**
 * Handles the full lifecycle of invitations and join requests for Sections,
 * plus one Group-targeted kind: a Group join request (targetType GROUP),
 * which asks to make that Group one's *formal* Group while its
 * joinRequiresApproval is on. It is only ever created through
 * PUT /users/me/formal-group (see createGroupJoinRequest) - POST .../join
 * and invitations still reject a GROUP target (groupHasNoMembership()), and
 * approving one never creates a Membership or Role, only the
 * FormalGroupAffiliation (see approveJoinRequest). Roles on a Group still
 * only come from RoleAssignmentsController (ADMIN) or
 * RoleAssignmentsService.transferOwnership (OWNER).
 *
 * Key domain invariants enforced here:
 *  - Accepting a request creates a SectionMembership AND grants MEMBER in
 *    the exact target Section, atomically (see fulfillJoin).
 *  - Accepting is idempotent: an already-active membership is surfaced as
 *    ALREADY_MEMBER, never silently duplicated.
 *  - Terminal requests (ACCEPTED/REJECTED/CANCELLED) cannot be re-processed.
 */
@Injectable()
export class MembershipRequestsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly auditLogService: AuditLogService,
    private readonly notificationsService: NotificationsService,
    private readonly r2StorageService: R2StorageService,
  ) {}

  private toDto(request: MembershipRequest): MembershipRequestResponseDto {
    return toMembershipRequestResponseDto(request, this.r2StorageService);
  }

  // ─── GROUP JOIN REQUEST (formal Group, joinRequiresApproval) ─────────────

  /**
   * Creates a PENDING Group join request inside the caller's transaction -
   * only ever called by UserProfileService.setFormalGroup once it has
   * decided the Group requires approval for this user. Any other PENDING
   * Group join request of the same user is cancelled (one formal Group, so
   * one request at a time - see cancelPendingGroupJoinRequests); a second
   * one to this same Group is refused (JOIN_REQUEST_ALREADY_PENDING), never
   * duplicated. Every OWNER/ADMIN of the Group is notified.
   */
  async createGroupJoinRequest(
    em: EntityManager,
    group: Group,
    user: User,
    startedOn: Date | null,
  ): Promise<MembershipRequestResponseDto> {
    const alreadyPending = await em.count(MembershipRequest, {
      targetGroup: group.id,
      initiatedBy: user.id,
      type: MembershipRequestType.JOIN_REQUEST,
      status: MembershipRequestStatus.PENDING,
    });
    if (alreadyPending > 0) {
      throw this.joinRequestAlreadyPending();
    }
    await cancelPendingGroupJoinRequests(em, user, null);

    const request = new MembershipRequest();
    request.type = MembershipRequestType.JOIN_REQUEST;
    request.targetType = MembershipRequestTarget.GROUP;
    assignTarget(request, group);
    request.initiatedBy = user;
    request.requestedStartedOn = startedOn;

    try {
      em.persist(request);
      await em.flush();
    } catch (error) {
      if (isUniqueViolationOn(error, MEMBERSHIP_REQUEST_PENDING_JOIN_IDX)) {
        throw this.joinRequestAlreadyPending();
      }
      throw error;
    }

    this.auditLogService.record(em, {
      community: group,
      action: AuditAction.JOIN_REQUEST,
      actor: user,
      targetType: AuditTargetType.MEMBERSHIP_REQUEST,
      targetId: request.id,
      metadata: {
        targetType: MembershipRequestTarget.GROUP,
        autoApproved: false,
      },
    });
    await em.flush();

    await this.notifyCommunityAdmins(
      em,
      group,
      NotificationType.GROUP_JOIN_REQUEST_RECEIVED,
      groupJoinRequestReceivedText(user.displayName, group.name),
      request.id,
      user,
    );

    return this.toDto(request);
  }

  // ─── JOIN (auto-join or join request based on isPublic) ──────────────────

  /**
   * "Join" button pressed by the authenticated user.
   *
   * - isPublic = true  → immediately creates SectionMembership + MEMBER.
   * - isPublic = false → creates a PENDING JOIN_REQUEST.
   *
   * isHidden has NO effect here.  A hidden Section is simply one that does
   * not appear in discovery searches — it is still joinable via a direct
   * link, publicCode, or QR code.
   *
   * GROUP target is always rejected - see groupHasNoMembership().
   */
  async join(
    targetGroupId: string,
    targetType: MembershipRequestTarget,
    requestingUser: User,
  ): Promise<MembershipRequestResponseDto | { joined: true }> {
    if (targetType === MembershipRequestTarget.GROUP) {
      throw groupHasNoMembership();
    }

    return this.em.transactional(async (em) => {
      const targetSection = await this.loadActiveSectionOrFail(
        em,
        targetGroupId,
      );

      await this.assertNotBanned(em, targetSection.id, requestingUser.id);
      await this.assertNotAlreadyJoined(em, targetSection, requestingUser);

      if (targetSection.isPublic) {
        // Auto-join path
        await this.fulfillJoin(em, targetSection, requestingUser);
        this.auditLogService.record(em, {
          community: targetSection,
          action: AuditAction.JOIN_REQUEST,
          actor: requestingUser,
          targetType: AuditTargetType.COMMUNITY,
          targetId: targetSection.id,
          metadata: { targetType, autoApproved: true },
        });
        await em.flush();
        return { joined: true };
      } else {
        // Create JOIN_REQUEST
        const request = new MembershipRequest();
        request.type = MembershipRequestType.JOIN_REQUEST;
        request.targetType = targetType;
        assignTarget(request, targetSection);
        request.initiatedBy = requestingUser;

        try {
          em.persist(request);
          await em.flush();
        } catch (error) {
          if (isUniqueViolationOn(error, MEMBERSHIP_REQUEST_PENDING_JOIN_IDX)) {
            throw this.joinRequestAlreadyPending();
          }
          throw error;
        }

        this.auditLogService.record(em, {
          community: targetSection,
          action: AuditAction.JOIN_REQUEST,
          actor: requestingUser,
          targetType: AuditTargetType.MEMBERSHIP_REQUEST,
          targetId: request.id,
          metadata: { targetType, autoApproved: false },
        });
        await em.flush();

        await this.notifyCommunityAdmins(
          em,
          targetSection,
          NotificationType.SECTION_JOIN_REQUEST_RECEIVED,
          sectionJoinRequestReceivedText(requestingUser.displayName),
          request.id,
          requestingUser,
        );

        return this.toDto(request);
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
        $or: [{ targetGroup: targetGroupId }, { targetSection: targetGroupId }],
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
   * memberInvitesAllowed check for MEMBER callers). GROUP target is always
   * rejected - see groupHasNoMembership().
   */
  async createInvitation(
    targetGroupId: string,
    input: CreateInvitationInput,
    inviter: User,
    callerRoles: GroupRole[],
    callerMembershipStatus: SectionMembershipStatus,
  ): Promise<MembershipRequestResponseDto> {
    if (input.targetType === MembershipRequestTarget.GROUP) {
      throw groupHasNoMembership();
    }

    return this.em.transactional(async (em) => {
      const targetSection = await this.loadActiveSectionOrFail(
        em,
        targetGroupId,
      );

      this.assertCanInviteToGroup(
        targetSection,
        callerRoles,
        callerMembershipStatus,
      );

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
        await this.assertNotAlreadyJoined(em, targetSection, invitedUser);
      } else {
        invitedEmail = input.invitedEmail!;

        // Check if a user with this email already has an account
        const existing = await em.findOne(User, { email: invitedEmail });
        if (existing) {
          invitedUser = existing;
          invitedEmail = null; // treat as user-based invitation
          await this.assertNotAlreadyJoined(em, targetSection, invitedUser);
        }
      }

      // Only checkable once an actual account is identified - an
      // email-only invitee with no account yet cannot have been banned
      // (banning requires having held a membership first).
      if (invitedUser) {
        await this.assertNotBanned(em, targetSection.id, invitedUser.id);
      }

      const request = new MembershipRequest();
      request.type = MembershipRequestType.INVITATION;
      request.targetType = input.targetType;
      assignTarget(request, targetSection);
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

      this.auditLogService.record(em, {
        community: targetSection,
        action: AuditAction.INVITE_MEMBER,
        actor: inviter,
        targetType: AuditTargetType.MEMBERSHIP_REQUEST,
        targetId: request.id,
        metadata: {
          targetType: input.targetType,
          invitedUserId: invitedUser?.id ?? null,
          invitedEmail: invitedEmail,
        },
      });
      await em.flush();

      // Only a resolved User can be notified (module spec: no email
      // channel exists) - an email-only invitee with no account yet simply
      // gets nothing here, same as every other User-only notification path.
      if (invitedUser) {
        await this.notificationsService.createMany(em, [
          this.buildMembershipNotificationParams(
            invitedUser,
            NotificationType.SECTION_INVITATION_RECEIVED,
            sectionInvitationReceivedText(),
            targetSection,
            request.id,
            inviter,
          ),
        ]);
      }

      return this.toDto(request);
    });
  }

  /**
   * Cancel a PENDING Invitation.
   *
   * Only three principals may cancel:
   *   1. The original inviter (initiatedBy) — regardless of their current
   *      role, they always own the invitation they sent.
   *   2. ADMIN of the target Section — can clean up any invitation for
   *      their Section.
   *   3. OWNER of the target Section — same as ADMIN, always allowed.
   *
   * A plain MEMBER (who is NOT the inviter) cannot cancel someone else's
   * invitation even if Section.memberInvitesAllowed is true.
   *
   * `callerRoles` must be the resolved Role Assignments of `actor` in the
   * target Section, supplied by the controller via resolveCallerContext().
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
   *
   * Same authorization rule as cancelInvitation(), since resending always
   * cancels the existing invitation as part of the operation: only the
   * original inviter, ADMIN, or OWNER may resend.
   */
  async resendInvitation(
    requestId: string,
    actor: User,
    callerRoles: GroupRole[],
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

      const isInviter = existing.initiatedBy.id === actor.id;
      const isAdminOrOwner = callerRoles.some(
        (r) => r === GroupRole.ADMIN || r === GroupRole.OWNER,
      );
      if (!isInviter && !isAdminOrOwner) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_PERMISSIONS_TO_RESEND_INVITATION',
          message:
            'Only the original inviter, ADMIN, or OWNER may resend an invitation',
        });
      }

      // Cancel old
      existing.status = MembershipRequestStatus.CANCELLED;
      existing.processedAt = new Date();
      existing.processedBy = actor;

      // Create new with same parameters
      const fresh = new MembershipRequest();
      fresh.type = MembershipRequestType.INVITATION;
      fresh.targetType = existing.targetType;
      assignTarget(fresh, requestTarget(existing));
      fresh.initiatedBy = actor;
      fresh.invitedUser = existing.invitedUser;
      fresh.invitedEmail = existing.invitedEmail;

      em.persist(fresh);
      await em.flush();

      return this.toDto(fresh);
    });
  }

  // ─── ACCEPT / REJECT (by the invitee) ────────────────────────────────────

  /**
   * The invitee accepts their PENDING INVITATION - creates the
   * SectionMembership and grants MEMBER atomically (see fulfillJoin).
   *
   * Idempotent at the membership level: if the invitee is somehow already
   * an active member (e.g. accepted through a different path
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
          populate: [
            'targetGroup',
            'targetSection',
            'invitedUser',
            'initiatedBy',
          ],
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

      const target = requestTarget(request);
      if (!(target instanceof Section)) {
        throw groupHasNoMembership();
      }
      await this.fulfillJoin(em, target, acceptingUser);

      request.status = MembershipRequestStatus.ACCEPTED;
      request.processedAt = new Date();
      request.processedBy = acceptingUser;

      this.recordRequestAudit(
        em,
        request,
        AuditAction.ACCEPT_INVITATION,
        acceptingUser,
      );
      await em.flush();

      await this.notificationsService.createMany(em, [
        this.buildMembershipNotificationParams(
          request.initiatedBy,
          NotificationType.SECTION_INVITATION_ACCEPTED,
          sectionInvitationAcceptedText(acceptingUser.displayName),
          target,
          request.id,
          acceptingUser,
        ),
      ]);
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
        {
          populate: [
            'invitedUser',
            'initiatedBy',
            'targetGroup',
            'targetSection',
          ],
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

      this.recordRequestAudit(
        em,
        request,
        AuditAction.DECLINE_INVITATION,
        rejectingUser,
      );
      await em.flush();

      await this.notificationsService.createMany(em, [
        this.buildMembershipNotificationParams(
          request.initiatedBy,
          NotificationType.SECTION_INVITATION_REJECTED,
          sectionInvitationRejectedText(rejectingUser.displayName),
          requestTarget(request),
          request.id,
          rejectingUser,
        ),
      ]);
    });
  }

  // ─── APPROVE / REJECT (by ADMIN/OWNER) ───────────────────────────────────

  /**
   * Approve a PENDING JOIN_REQUEST.  Authorization guard already confirmed
   * the actor has GROUP_JOIN_REQUEST_REVIEW on `communityId` (the route's
   * :groupId/:sectionId) - the request must target exactly that community,
   * or a reviewer of one community could process another's requests.
   *
   * Section target: SectionMembership + MEMBER (fulfillJoin). Group target
   * (formal Group): only now does the requester's FormalGroupAffiliation
   * switch to this Group - the old one ends and the new one starts in this
   * same transaction (switchFormalGroup), and their other pending Group
   * join requests are cancelled.
   */
  async approveJoinRequest(
    requestId: string,
    communityId: string,
    actor: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(
        MembershipRequest,
        { id: requestId },
        {
          populate: ['targetGroup', 'targetSection', 'initiatedBy'],
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
      this.assertRequestTargets(request, communityId);
      this.assertPending(request);

      const target = requestTarget(request);
      if (target instanceof Group) {
        if (target.status !== GroupStatus.ACTIVE) {
          throw new ConflictException({
            code: 'FORMAL_GROUP_NOT_ACTIVE',
            message: 'This group is not currently active',
          });
        }
        await switchFormalGroup(
          em,
          request.initiatedBy,
          target,
          request.requestedStartedOn,
        );
        await cancelPendingGroupJoinRequests(
          em,
          request.initiatedBy,
          request.id,
        );
      } else {
        await this.fulfillJoin(em, target, request.initiatedBy);
      }

      request.status = MembershipRequestStatus.ACCEPTED;
      request.processedAt = new Date();
      request.processedBy = actor;

      this.recordRequestAudit(
        em,
        request,
        AuditAction.APPROVE_JOIN_REQUEST,
        actor,
      );
      await em.flush();

      await this.notificationsService.createMany(em, [
        this.buildMembershipNotificationParams(
          request.initiatedBy,
          target instanceof Group
            ? NotificationType.GROUP_JOIN_REQUEST_APPROVED
            : NotificationType.SECTION_JOIN_REQUEST_APPROVED,
          target instanceof Group
            ? groupJoinRequestApprovedText(target.name)
            : sectionJoinRequestApprovedText(),
          target,
          request.id,
          actor,
        ),
      ]);
    });
  }

  /**
   * Reject a PENDING JOIN_REQUEST (same `communityId` check as approve).
   * Nothing else changes - for a Group target the requester's formal Group
   * stays as it was, and they may send a new request later (the REJECTED
   * row stays as history; the pending-unique index only covers PENDING).
   */
  async rejectJoinRequest(
    requestId: string,
    communityId: string,
    actor: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      const request = await em.findOne(
        MembershipRequest,
        { id: requestId },
        { populate: ['targetGroup', 'targetSection', 'initiatedBy'] },
      );
      if (!request) throw this.requestNotFound();

      if (request.type !== MembershipRequestType.JOIN_REQUEST) {
        throw new UnprocessableEntityException({
          code: 'NOT_A_JOIN_REQUEST',
          message: 'This request is not a join request',
        });
      }
      this.assertRequestTargets(request, communityId);
      this.assertPending(request);

      request.status = MembershipRequestStatus.REJECTED;
      request.processedAt = new Date();
      request.processedBy = actor;

      this.recordRequestAudit(
        em,
        request,
        AuditAction.REJECT_JOIN_REQUEST,
        actor,
      );
      await em.flush();

      const target = requestTarget(request);
      await this.notificationsService.createMany(em, [
        this.buildMembershipNotificationParams(
          request.initiatedBy,
          target instanceof Group
            ? NotificationType.GROUP_JOIN_REQUEST_REJECTED
            : NotificationType.SECTION_JOIN_REQUEST_REJECTED,
          target instanceof Group
            ? groupJoinRequestRejectedText(target.name)
            : sectionJoinRequestRejectedText(),
          target,
          request.id,
          actor,
        ),
      ]);
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
        populate: [
          'targetGroup',
          'targetSection',
          'initiatedBy',
          'invitedUser',
          'processedBy',
        ],
      },
    );
    return requests.map((request) => this.toDto(request));
  }

  /** All invitations sent for a specific target group (managed view). */
  async listInvitationsForGroup(
    targetGroupId: string,
  ): Promise<MembershipRequestResponseDto[]> {
    const requests = await this.em.find(
      MembershipRequest,
      {
        $or: [{ targetGroup: targetGroupId }, { targetSection: targetGroupId }],
        type: MembershipRequestType.INVITATION,
        status: MembershipRequestStatus.PENDING,
      },
      {
        populate: [
          'initiatedBy',
          'invitedUser',
          'processedBy',
          'targetGroup',
          'targetSection',
        ],
      },
    );
    return requests.map((request) => this.toDto(request));
  }

  /** All PENDING join requests for a target group (admin view). */
  async listJoinRequestsForGroup(
    targetGroupId: string,
  ): Promise<MembershipRequestResponseDto[]> {
    const requests = await this.em.find(
      MembershipRequest,
      {
        $or: [{ targetGroup: targetGroupId }, { targetSection: targetGroupId }],
        type: MembershipRequestType.JOIN_REQUEST,
        status: MembershipRequestStatus.PENDING,
      },
      {
        populate: [
          'initiatedBy',
          'processedBy',
          'targetGroup',
          'targetSection',
        ],
      },
    );
    return requests.map((request) => this.toDto(request));
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
        $or: [
          { targetGroup: { $in: targetGroupIds } },
          { targetSection: { $in: targetGroupIds } },
        ],
        type: MembershipRequestType.JOIN_REQUEST,
        status: MembershipRequestStatus.PENDING,
      },
      {
        populate: [
          'initiatedBy',
          'processedBy',
          'targetGroup',
          'targetSection',
        ],
      },
    );
    return requests.map((request) => this.toDto(request));
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  /**
   * Creates the SectionMembership and grants MEMBER atomically for an
   * auto-join or accepted request - the single place (alongside
   * SectionMembershipsService.addMember and SectionsService.create) that
   * ever creates a membership.
   */
  private async fulfillJoin(
    em: EntityManager,
    targetSection: Section,
    user: User,
  ): Promise<void> {
    // Re-checked here (not just at Join/Invite creation time) since this is
    // also reached by acceptInvitation/approveJoinRequest, which can run
    // well after the underlying request was created - a ban imposed in the
    // meantime must still block the membership from actually being created.
    await this.assertNotBanned(em, targetSection.id, user.id);

    const existing = await loadActiveSectionMembership(
      em,
      targetSection.id,
      user.id,
    );
    if (existing) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'You are already a member of this section',
      });
    }

    const membership = new SectionMembership();
    membership.section = targetSection;
    membership.user = user;
    membership.joinedAt = new Date();

    try {
      em.persist(membership);
      await this.roleAssignmentsService.insertRoleAssignment(
        em,
        user,
        targetSection,
        GroupRole.MEMBER,
        user,
      );
    } catch (error) {
      if (isUniqueViolationOn(error, SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX)) {
        throw new ConflictException({
          code: 'ALREADY_MEMBER',
          message: 'You are already a member of this section',
        });
      }
      throw error;
    }
  }

  /**
   * Throws if the user already has an active SectionMembership for the
   * target Section.
   */
  private async assertNotAlreadyJoined(
    em: EntityManager,
    targetSection: Section,
    user: User,
  ): Promise<void> {
    const membership = await loadActiveSectionMembership(
      em,
      targetSection.id,
      user.id,
    );
    if (membership) {
      throw new ConflictException({
        code: 'ALREADY_MEMBER',
        message: 'You are already a member of this section',
      });
    }
  }

  /**
   * Throws if `userId` currently holds an active (unlifted) SectionBan for
   * `sectionId` - see SectionBan. Called from every path that would create
   * or reactivate a membership (join, and - via fulfillJoin -
   * acceptInvitation/approveJoinRequest) and from createInvitation (so a
   * banned user cannot even be re-invited).
   */
  private async assertNotBanned(
    em: EntityManager,
    sectionId: string,
    userId: string,
  ): Promise<void> {
    const ban = await em.findOne(SectionBan, {
      section: sectionId,
      user: userId,
      liftedAt: null,
    });
    if (ban) {
      throw new ForbiddenException({
        code: 'USER_BANNED',
        message: 'This user is banned from this section',
      });
    }
  }

  /**
   * Records the audit entry under the *exact* request target - never a
   * resolved root - matching the "no inheritance" rule applied to audit
   * trails elsewhere. Shared by accept/decline Invitation and
   * approve/reject Join Request.
   */
  private recordRequestAudit(
    em: EntityManager,
    request: MembershipRequest,
    action: AuditAction,
    actor: User,
  ): void {
    this.auditLogService.record(em, {
      community: requestTarget(request),
      action,
      actor,
      targetType: AuditTargetType.MEMBERSHIP_REQUEST,
      targetId: request.id,
    });
  }

  private buildMembershipNotificationParams(
    recipient: User,
    type: NotificationType,
    text: { title: string; body: string },
    community: Community,
    membershipRequestId: string,
    actor: User,
  ): CreateNotificationParams {
    return {
      recipient,
      category: NotificationCategory.MEMBERSHIP,
      type,
      title: text.title,
      body: text.body,
      targetType: NotificationTargetType.MEMBERSHIP_REQUEST,
      targetId: membershipRequestId,
      contextGroup: community instanceof Group ? community : null,
      contextSection: community instanceof Section ? community : null,
      actor,
    };
  }

  /**
   * Recipients: every currently active ADMIN/OWNER of exactly `community`
   * (module spec: newJoinRequests is "admin-facing" - see
   * CommunityNotificationSettings' own field comment). Never inherited from
   * or to a parent/child.
   */
  private async notifyCommunityAdmins(
    em: EntityManager,
    community: Community,
    type: NotificationType,
    text: { title: string; body: string },
    membershipRequestId: string,
    actor: User,
  ): Promise<void> {
    const assignments = await em.find(RoleAssignment, {
      ...communityIdFilter(community.id),
      role: { $in: [GroupRole.ADMIN, GroupRole.OWNER] },
      revokedAt: null,
    });
    const recipientIds = [...new Set(assignments.map((a) => a.user.id))];
    if (recipientIds.length === 0) {
      return;
    }
    const params = recipientIds.map((userId) =>
      this.buildMembershipNotificationParams(
        em.getReference(User, userId),
        type,
        text,
        community,
        membershipRequestId,
        actor,
      ),
    );
    await this.notificationsService.createMany(em, params);
  }

  /** Enforces that a MEMBER may only invite when memberInvitesAllowed=true. */
  private assertCanInviteToGroup(
    targetSection: Section,
    callerRoles: GroupRole[],
    callerMembershipStatus: SectionMembershipStatus,
  ): void {
    const hasAdminOrOwner = callerRoles.some(
      (r) => r === GroupRole.ADMIN || r === GroupRole.OWNER,
    );
    if (hasAdminOrOwner) return; // ADMIN/OWNER always allowed

    // MEMBER (or INSTRUCTOR/ASSISTANT) path - require setting
    if (!targetSection.memberInvitesAllowed) {
      throw new ForbiddenException({
        code: 'MEMBER_INVITES_NOT_ALLOWED',
        message:
          'Member invitations are disabled for this section; only ADMIN and OWNER may invite',
      });
    }
    if (callerMembershipStatus !== SectionMembershipStatus.ACTIVE) {
      throw new ForbiddenException({
        code: 'MEMBERSHIP_NOT_ACTIVE',
        message: 'Only active members may send invitations',
      });
    }
  }

  private assertRequestTargets(
    request: MembershipRequest,
    communityId: string,
  ): void {
    if (requestTarget(request).id !== communityId) {
      throw this.requestNotFound();
    }
  }

  private joinRequestAlreadyPending(): ConflictException {
    return new ConflictException({
      code: 'JOIN_REQUEST_ALREADY_PENDING',
      message: 'You already have a pending join request for this community',
    });
  }

  private assertPending(request: MembershipRequest): void {
    if (request.status !== MembershipRequestStatus.PENDING) {
      throw new ConflictException({
        code: 'REQUEST_NOT_PENDING',
        message: `This request is already ${request.status.toLowerCase()} and cannot be processed again`,
      });
    }
  }

  private async loadActiveSectionOrFail(
    em: EntityManager,
    sectionId: string,
  ): Promise<Section> {
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw new NotFoundException({
        code: 'SECTION_NOT_FOUND',
        message: 'Section not found',
      });
    }
    if (section.status === GroupStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'GROUP_ARCHIVED',
        message:
          'This section is archived and is read-only until it is restored',
      });
    }
    return section;
  }

  private async loadRequestByIdOrFail(
    em: EntityManager,
    requestId: string,
  ): Promise<MembershipRequest> {
    const request = await em.findOne(
      MembershipRequest,
      { id: requestId },
      {
        populate: [
          'targetGroup',
          'targetSection',
          'initiatedBy',
          'invitedUser',
          'processedBy',
        ],
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
  urlBuilder: PublicUrlBuilder,
): MembershipRequestResponseDto {
  return {
    id: request.id,
    type: request.type,
    targetType: request.targetType,
    targetGroupId: requestTarget(request).id,
    status: request.status,
    initiatedBy: {
      id: request.initiatedBy.id,
      displayName: request.initiatedBy.displayName,
      apelido: request.initiatedBy.apelido,
      image: {
        type: request.initiatedBy.avatarType,
        url: resolveUserAvatarUrl(request.initiatedBy, urlBuilder),
        presetAvatarId: request.initiatedBy.presetAvatarId,
      },
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
    requestedStartedOn: toDateOnly(request.requestedStartedOn),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  };
}

// Same 'date'-column handling as user-profile.mapper.ts's own toDateOnly -
// the driver may hand back either a Date or an already-formatted string.
function toDateOnly(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}
