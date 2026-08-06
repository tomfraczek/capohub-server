import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { PaginatedResponse } from '../common/pagination/pagination.types';
import { createPaginationMeta } from '../common/pagination/pagination.utils';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { Section } from '../groups/entities/section.entity';
import { SectionMembership } from '../groups/entities/section-membership.entity';
import { GroupRole } from '../groups/enums/group-role.enum';
import { SectionMembershipStatus } from '../groups/enums/section-membership-status.enum';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { User } from '../users/entities/user.entity';
import { CreateFormalRankCorrectionInput } from './dto/create-formal-rank-correction.schema';
import { FormalRankCorrectionOwnResponseDto } from './dto/formal-rank-correction-own-response.dto';
import { FormalRankCorrectionQuery } from './dto/formal-rank-correction-query.schema';
import { FormalRankCorrectionResponseDto } from './dto/formal-rank-correction-response.dto';
import { RejectFormalRankCorrectionInput } from './dto/reject-formal-rank-correction.schema';
import { SubmitFormalRankCorrectionInput } from './dto/submit-formal-rank-correction.schema';
import {
  ACTIVE_FORMAL_RANK_CORRECTION_STATUSES,
  FormalRankCorrectionStatus,
} from './enums/formal-rank-correction-status.enum';
import { FormalRankCorrectionNotificationType } from './enums/formal-rank-correction-notification-type.enum';
import { FormalRankAssignment } from './entities/formal-rank-assignment.entity';
import {
  FORMAL_RANK_CORRECTION_REQUESTS_ACTIVE_UNIQUE_INDEX,
  FormalRankCorrectionRequest,
} from './entities/formal-rank-correction-request.entity';
import { FormalRankCorrectionNotification } from './entities/formal-rank-correction-notification.entity';
import { Rank } from './entities/rank.entity';
import {
  toFormalRankCorrectionOwnResponseDto,
  toFormalRankCorrectionResponseDto,
} from './mappers/formal-rank-correction.mapper';

const ACTIVE_MEMBERSHIP_STATUSES = [
  SectionMembershipStatus.ACTIVE,
  SectionMembershipStatus.READ_ONLY,
];

const REQUEST_POPULATE = [
  'targetUser',
  'section',
  'formalRankAssignment.rank',
  'submittedRank',
  'reportedBy',
  'reviewedBy',
] as const;

/**
 * The formal rank *correction* workflow - fixing a misrecorded
 * FormalRankAssignment.rank, never a new award (see
 * formal-rank-correction-request.entity.ts). Authorization for the exact
 * Section (OWNER/ADMIN, with an active membership - "no inheritance") is
 * already enforced by GroupPermissionsGuard before any handler here runs
 * (see formal-rank-corrections.controller.ts) - this service owns the
 * workflow's own invariants: one active request per FormalRankAssignment,
 * the "variant C" review rule (OWNER always, ADMIN only their own
 * report), and re-validating every precondition at each step so a stale
 * request can never silently corrupt a newer state (see approve()).
 */
@Injectable()
export class FormalRankCorrectionService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // ─── Section admin surface ────────────────────────────────────────────

  async request(
    sectionId: string,
    input: CreateFormalRankCorrectionInput,
    actor: User,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.em.transactional(async (em) => {
      const section = em.getReference(Section, sectionId);

      const targetUser = await em.findOne(User, { id: input.targetUserId });
      if (!targetUser) {
        throw this.userNotFound();
      }

      const targetMembership = await em.findOne(SectionMembership, {
        section: sectionId,
        user: targetUser.id,
        status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
      });
      if (!targetMembership) {
        throw new ConflictException({
          code: 'TARGET_NOT_SECTION_MEMBER',
          message: 'The target user is not an active member of this section',
        });
      }

      const assignment = await em.findOne(
        FormalRankAssignment,
        { user: targetUser.id, endedOn: null },
        { populate: ['rank.system.group'] },
      );
      if (!assignment) {
        throw new ConflictException({
          code: 'TARGET_HAS_NO_ACTIVE_FORMAL_RANK',
          message: 'The target user has no active formal rank to correct',
        });
      }

      const formalGroup = await this.loadActiveFormalGroup(em, targetUser.id);
      if (!formalGroup) {
        throw new ConflictException({
          code: 'TARGET_HAS_NO_ACTIVE_FORMAL_GROUP',
          message: 'The target user has no active formal group affiliation',
        });
      }
      if (assignment.rank.system.group.id !== formalGroup.group.id) {
        throw new ConflictException({
          code: 'FORMAL_RANK_NOT_IN_CURRENT_CATALOG',
          message:
            "The target's current formal rank does not belong to their current formal group's catalog",
        });
      }

      const existingActive = await em.findOne(FormalRankCorrectionRequest, {
        formalRankAssignment: assignment.id,
        status: { $in: ACTIVE_FORMAL_RANK_CORRECTION_STATUSES },
      });
      if (existingActive) {
        throw this.correctionAlreadyActive();
      }

      const request = new FormalRankCorrectionRequest();
      request.formalRankAssignment = assignment;
      request.targetUser = targetUser;
      request.section = section;
      request.reportedBy = actor;
      request.status = FormalRankCorrectionStatus.CORRECTION_REQUIRED;
      request.reason = input.reason;

      try {
        em.persist(request);
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(
            error,
            FORMAL_RANK_CORRECTION_REQUESTS_ACTIVE_UNIQUE_INDEX,
          )
        ) {
          throw this.correctionAlreadyActive();
        }
        throw error;
      }

      this.auditLogService.record(em, {
        community: section,
        action: AuditAction.REQUEST_FORMAL_RANK_CORRECTION,
        actor,
        targetType: AuditTargetType.USER,
        targetId: targetUser.id,
        metadata: {
          requestId: request.id,
          targetUserId: targetUser.id,
          formalRankAssignmentId: assignment.id,
          oldRankId: assignment.rank.id,
        },
      });
      await em.flush();

      await this.notify(
        em,
        [targetUser],
        FormalRankCorrectionNotificationType.FORMAL_RANK_CORRECTION_REQUESTED,
        request,
      );

      return toFormalRankCorrectionResponseDto(request, assignment.rank);
    });
  }

  async list(
    sectionId: string,
    query: FormalRankCorrectionQuery,
  ): Promise<PaginatedResponse<FormalRankCorrectionResponseDto>> {
    const where: Record<string, unknown> = { section: sectionId };
    if (query.status) {
      where.status = query.status;
    }

    const [requests, totalItems] = await this.em.findAndCount(
      FormalRankCorrectionRequest,
      where,
      {
        populate: [...REQUEST_POPULATE],
        orderBy: { createdAt: 'desc' },
        limit: query.limit,
        offset: (query.page - 1) * query.limit,
      },
    );

    return {
      data: requests.map((r) =>
        toFormalRankCorrectionResponseDto(r, r.formalRankAssignment.rank),
      ),
      meta: createPaginationMeta({
        page: query.page,
        limit: query.limit,
        totalItems,
      }),
    };
  }

  async getById(
    sectionId: string,
    requestId: string,
  ): Promise<FormalRankCorrectionResponseDto> {
    const request = await this.loadByIdOrFail(this.em, sectionId, requestId);
    return toFormalRankCorrectionResponseDto(
      request,
      request.formalRankAssignment.rank,
    );
  }

  async approve(
    sectionId: string,
    requestId: string,
    actor: User,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.em.transactional(async (em) => {
      const request = await this.loadForReview(em, sectionId, requestId, [
        'targetUser',
        'section',
        'formalRankAssignment.rank',
        'submittedRank.system.group',
        'reportedBy',
        'reviewedBy',
      ]);
      if (!request) {
        throw this.correctionNotFound();
      }
      this.assertPendingApproval(request, 'approved');

      await this.assertCanReview(em, sectionId, actor, request);

      const targetMembership = await em.findOne(SectionMembership, {
        section: sectionId,
        user: request.targetUser.id,
        status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
      });
      if (!targetMembership) {
        throw new ConflictException({
          code: 'TARGET_NOT_SECTION_MEMBER',
          message:
            'The target user is no longer an active member of this section',
        });
      }

      const formalGroup = await this.loadActiveFormalGroup(
        em,
        request.targetUser.id,
      );
      if (!formalGroup) {
        throw new ConflictException({
          code: 'TARGET_HAS_NO_ACTIVE_FORMAL_GROUP',
          message: 'The target user has no active formal group affiliation',
        });
      }

      const submittedRank = request.submittedRank!;
      if (submittedRank.isArchived) {
        throw new ConflictException({
          code: 'RANK_ARCHIVED',
          message: 'The proposed rank has since been archived',
        });
      }
      if (submittedRank.system.group.id !== formalGroup.group.id) {
        // The target's formal group changed between submit and approve -
        // never silently approve against a now-stale catalog. Bounces the
        // request back to CORRECTION_REQUIRED so the target must submit
        // again, against their current catalog (see the module spec,
        // rule 6: "wtedy nie akceptuj, tylko zwróć konflikt wymagający
        // ponownej poprawy").
        request.status = FormalRankCorrectionStatus.CORRECTION_REQUIRED;
        request.submittedRank = null;
        request.submittedAwardedByName = null;
        request.submittedAt = null;
        await em.flush();
        throw new ConflictException({
          code: 'FORMAL_GROUP_CHANGED_REQUIRES_RESUBMISSION',
          message:
            "The target's formal group has changed since this correction was submitted; they must submit again",
        });
      }

      // Re-locked and re-checked here (not just resolved via
      // request.formalRankAssignment above) - a concurrent
      // FormalRankService.setCurrent could have ended this exact
      // assignment and started a new one between request/submit and this
      // approve call. Never let a stale request modify a
      // FormalRankAssignment it no longer describes (see the module
      // spec's race-condition rules).
      const assignment = await em.findOne(
        FormalRankAssignment,
        { id: request.formalRankAssignment.id },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['rank'] },
      );
      if (!assignment || assignment.endedOn !== null) {
        throw new ConflictException({
          code: 'FORMAL_RANK_ASSIGNMENT_NO_LONGER_CURRENT',
          message:
            'This formal rank assignment is no longer the current one and can no longer be corrected',
        });
      }

      const oldRankId = assignment.rank.id;
      // The correction itself: same row, only `rank` (and, only if
      // explicitly proposed, `awardedByName`) changes. startedOn/endedOn/
      // sourceGroup are never touched, and no new FormalRankAssignment or
      // history row is ever created - a correction is not a new award
      // (see the module spec's core rule).
      assignment.rank = submittedRank;
      if (request.submittedAwardedByName !== null) {
        assignment.awardedByName = request.submittedAwardedByName;
      }

      request.status = FormalRankCorrectionStatus.APPROVED;
      request.reviewedAt = new Date();
      request.reviewedBy = actor;
      await em.flush();

      this.auditLogService.record(em, {
        community: request.section,
        action: AuditAction.APPROVE_FORMAL_RANK_CORRECTION,
        actor,
        targetType: AuditTargetType.USER,
        targetId: request.targetUser.id,
        metadata: {
          requestId: request.id,
          targetUserId: request.targetUser.id,
          formalRankAssignmentId: assignment.id,
          oldRankId,
          proposedRankId: submittedRank.id,
          finalRankId: assignment.rank.id,
        },
      });
      await em.flush();

      await this.notify(
        em,
        [request.targetUser],
        FormalRankCorrectionNotificationType.FORMAL_RANK_CORRECTION_APPROVED,
        request,
      );

      return toFormalRankCorrectionResponseDto(request, assignment.rank);
    });
  }

  async reject(
    sectionId: string,
    requestId: string,
    input: RejectFormalRankCorrectionInput,
    actor: User,
  ): Promise<FormalRankCorrectionResponseDto> {
    return this.em.transactional(async (em) => {
      const request = await this.loadForReview(em, sectionId, requestId, [
        'targetUser',
        'section',
        'formalRankAssignment.rank',
        'submittedRank',
        'reportedBy',
        'reviewedBy',
      ]);
      if (!request) {
        throw this.correctionNotFound();
      }
      this.assertPendingApproval(request, 'rejected');

      await this.assertCanReview(em, sectionId, actor, request);

      const targetMembership = await em.findOne(SectionMembership, {
        section: sectionId,
        user: request.targetUser.id,
        status: { $in: ACTIVE_MEMBERSHIP_STATUSES },
      });
      if (!targetMembership) {
        throw new ConflictException({
          code: 'TARGET_NOT_SECTION_MEMBER',
          message:
            'The target user is no longer an active member of this section',
        });
      }

      request.status = FormalRankCorrectionStatus.REJECTED;
      request.reviewedAt = new Date();
      request.reviewedBy = actor;
      request.rejectionReason = input.reason;
      await em.flush();

      this.auditLogService.record(em, {
        community: request.section,
        action: AuditAction.REJECT_FORMAL_RANK_CORRECTION,
        actor,
        targetType: AuditTargetType.USER,
        targetId: request.targetUser.id,
        metadata: {
          requestId: request.id,
          targetUserId: request.targetUser.id,
          formalRankAssignmentId: request.formalRankAssignment.id,
          oldRankId: request.formalRankAssignment.rank.id,
          proposedRankId: request.submittedRank?.id ?? null,
          rejectionReason: input.reason,
        },
      });
      await em.flush();

      await this.notify(
        em,
        [request.targetUser],
        FormalRankCorrectionNotificationType.FORMAL_RANK_CORRECTION_REJECTED,
        request,
      );

      return toFormalRankCorrectionResponseDto(
        request,
        request.formalRankAssignment.rank,
      );
    });
  }

  // ─── Own-user surface ─────────────────────────────────────────────────

  async getMyActive(user: User): Promise<FormalRankCorrectionOwnResponseDto> {
    // Scoped to the *current* FormalRankAssignment, not just "any active
    // request for this user" - a correction request tied to a superseded
    // assignment (e.g. the user's formal rank was ended and replaced
    // through the ordinary FormalRankService flow while a correction on
    // the old one was still unresolved) must never surface here or in
    // submit() below, mirroring the same "never let a stale request touch
    // a newer assignment" rule approve() enforces (see the module spec's
    // race-condition rules).
    const currentAssignment = await this.em.findOne(FormalRankAssignment, {
      user: user.id,
      endedOn: null,
    });
    if (!currentAssignment) {
      throw this.noActiveCorrection();
    }

    const request = await this.em.findOne(
      FormalRankCorrectionRequest,
      {
        formalRankAssignment: currentAssignment.id,
        status: { $in: ACTIVE_FORMAL_RANK_CORRECTION_STATUSES },
      },
      { populate: [...REQUEST_POPULATE] },
    );
    if (!request) {
      throw this.noActiveCorrection();
    }

    const formalGroup = await this.loadActiveFormalGroup(this.em, user.id);
    const catalogGroupId =
      formalGroup?.group.id ?? request.formalRankAssignment.sourceGroup.id;

    return toFormalRankCorrectionOwnResponseDto(
      request,
      request.formalRankAssignment.rank,
      catalogGroupId,
    );
  }

  async submit(
    user: User,
    input: SubmitFormalRankCorrectionInput,
  ): Promise<FormalRankCorrectionOwnResponseDto> {
    return this.em.transactional(async (em) => {
      // Scoped to the *current* FormalRankAssignment - see getMyActive's
      // identical comment. Locked without `populate` - see
      // loadForReview's own comment: `FOR UPDATE` cannot be combined with
      // the LEFT JOINs this row's nullable relations
      // (submittedRank/reportedBy/reviewedBy) would otherwise produce.
      // Populated separately, after the lock is already held.
      const currentAssignment = await em.findOne(FormalRankAssignment, {
        user: user.id,
        endedOn: null,
      });
      if (!currentAssignment) {
        throw this.noActiveCorrection();
      }

      const request = await em.findOne(
        FormalRankCorrectionRequest,
        {
          formalRankAssignment: currentAssignment.id,
          status: {
            $in: [
              FormalRankCorrectionStatus.CORRECTION_REQUIRED,
              FormalRankCorrectionStatus.REJECTED,
            ],
          },
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!request) {
        throw this.noActiveCorrection();
      }
      await em.populate(request, [...REQUEST_POPULATE]);

      const { rank, formalGroup } = await this.validateSubmittedRank(
        em,
        user.id,
        input.rankId,
      );

      request.submittedRank = rank;
      request.submittedAwardedByName = input.awardedByName;
      request.status = FormalRankCorrectionStatus.PENDING_APPROVAL;
      request.submittedAt = new Date();
      await em.flush();

      // Logged under the exact Section, even though this is the target's
      // own action - it happens entirely within a workflow that Section's
      // administration opened (request()), so it belongs in that
      // Section's own audit record, not omitted the way an ordinary
      // profile edit (e.g. FormalRankService.setCurrent) is.
      this.auditLogService.record(em, {
        community: request.section,
        action: AuditAction.SUBMIT_FORMAL_RANK_CORRECTION,
        actor: user,
        targetType: AuditTargetType.USER,
        targetId: user.id,
        metadata: {
          requestId: request.id,
          targetUserId: user.id,
          formalRankAssignmentId: request.formalRankAssignment.id,
          oldRankId: request.formalRankAssignment.rank.id,
          proposedRankId: rank.id,
        },
      });
      await em.flush();

      const owner = await this.loadSectionOwner(em, request.section.id);
      const recipients = this.dedupeUsers(
        [request.reportedBy, owner].filter((u): u is User => u !== null),
      );
      await this.notify(
        em,
        recipients,
        FormalRankCorrectionNotificationType.FORMAL_RANK_CORRECTION_SUBMITTED,
        request,
      );

      return toFormalRankCorrectionOwnResponseDto(
        request,
        request.formalRankAssignment.rank,
        formalGroup.group.id,
      );
    });
  }

  // ─── Visibility contract ──────────────────────────────────────────────

  /**
   * Whether `formalRankAssignmentId`'s Rank may currently be shown to
   * anyone other than its owner - `false` exactly while an active
   * (CORRECTION_REQUIRED/PENDING_APPROVAL) correction exists for it (see
   * the module spec, rule 3). This is the single source of truth for that
   * question; nothing hides a rank by nulling/deleting the
   * FormalRankAssignment itself. No consumer wires this into a public
   * profile DTO yet (PublicUserProfileResponseDto has no formal-rank
   * field and no privacy flag for one - adding either is a separate,
   * User-module change out of scope here), but any future integration
   * must call this before including formal rank data in a non-owner
   * response.
   */
  async isPubliclyVisible(
    formalRankAssignmentId: string,
    em: EntityManager = this.em,
  ): Promise<boolean> {
    const activeRequest = await em.findOne(FormalRankCorrectionRequest, {
      formalRankAssignment: formalRankAssignmentId,
      status: {
        $in: [
          FormalRankCorrectionStatus.CORRECTION_REQUIRED,
          FormalRankCorrectionStatus.PENDING_APPROVAL,
        ],
      },
    });
    return !activeRequest;
  }

  // ─── Internals ──────────────────────────────────────────────────────────

  /**
   * Variant C: the Section OWNER may review any active request; an ADMIN
   * may only review the one they reported themselves (see the module
   * spec, section 6/7). Re-resolved from the DB on every call (never
   * trusts a role list computed earlier in the request), so a caller who
   * lost ADMIN between opening the review screen and submitting the
   * decision is re-rejected here.
   */
  private async assertCanReview(
    em: EntityManager,
    sectionId: string,
    actor: User,
    request: FormalRankCorrectionRequest,
  ): Promise<void> {
    const isOwner = await this.roleAssignmentsService.hasRole(
      em,
      actor.id,
      sectionId,
      GroupRole.OWNER,
    );
    if (isOwner) {
      return;
    }

    const isAdmin = await this.roleAssignmentsService.hasRole(
      em,
      actor.id,
      sectionId,
      GroupRole.ADMIN,
    );
    const isReporter = request.reportedBy?.id === actor.id;
    if (!isAdmin || !isReporter) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_REVIEW_PERMISSIONS',
        message:
          'Only the Section OWNER, or the ADMIN who reported this correction, may review it',
      });
    }
  }

  private async validateSubmittedRank(
    em: EntityManager,
    userId: string,
    rankId: string,
  ): Promise<{ rank: Rank; formalGroup: FormalGroupAffiliation }> {
    const formalGroup = await this.loadActiveFormalGroup(em, userId);
    if (!formalGroup) {
      throw new ConflictException({
        code: 'TARGET_HAS_NO_ACTIVE_FORMAL_GROUP',
        message: 'You have no active formal group affiliation',
      });
    }

    const rank = await em.findOne(
      Rank,
      { id: rankId },
      { populate: ['system.group'] },
    );
    if (!rank) {
      throw new NotFoundException({
        code: 'RANK_NOT_FOUND',
        message: 'Rank not found',
      });
    }
    if (rank.isArchived) {
      throw new ConflictException({
        code: 'RANK_ARCHIVED',
        message: 'This rank is archived and can no longer be newly selected',
      });
    }
    if (!rank.system.isActive) {
      throw new ConflictException({
        code: 'GRADUATION_SYSTEM_NOT_ACTIVE',
        message: 'This rank no longer belongs to an active graduation system',
      });
    }
    if (rank.system.group.id !== formalGroup.group.id) {
      throw new ConflictException({
        code: 'RANK_NOT_IN_FORMAL_GROUP_CATALOG',
        message: "This rank does not belong to your formal group's catalog",
      });
    }

    return { rank, formalGroup };
  }

  private async loadActiveFormalGroup(
    em: EntityManager,
    userId: string,
  ): Promise<FormalGroupAffiliation | null> {
    return em.findOne(
      FormalGroupAffiliation,
      { user: userId, endedOn: null },
      { populate: ['group'] },
    );
  }

  private async loadSectionOwner(
    em: EntityManager,
    sectionId: string,
  ): Promise<User | null> {
    const ownerAssignment = await em.findOne(
      RoleAssignment,
      { section: sectionId, role: GroupRole.OWNER, revokedAt: null },
      { populate: ['user'] },
    );
    return ownerAssignment?.user ?? null;
  }

  /**
   * Persists one notification row per unique recipient - a purely
   * server-side, queryable record (see FormalRankCorrectionNotification's
   * own comment on why there is no push/email delivery). Deduplicates by
   * user id so e.g. an OWNER who is also the reporter never gets two rows
   * for the same event (see the module spec's SUBMITTED recipients rule).
   */
  private async notify(
    em: EntityManager,
    recipients: User[],
    type: FormalRankCorrectionNotificationType,
    request: FormalRankCorrectionRequest,
  ): Promise<void> {
    const unique = this.dedupeUsers(recipients);
    if (unique.length === 0) {
      return;
    }
    for (const recipient of unique) {
      const notification = new FormalRankCorrectionNotification();
      notification.recipient = recipient;
      notification.type = type;
      notification.correctionRequest = request;
      em.persist(notification);
    }
    await em.flush();
  }

  private dedupeUsers(users: readonly User[]): User[] {
    return [...new Map(users.map((u) => [u.id, u])).values()];
  }

  /**
   * Locks the request row by (id, section) for approve()/reject(), then
   * populates it in a second step. `lockMode: PESSIMISTIC_WRITE` cannot be
   * combined with a `populate` that reaches this entity's nullable
   * relations (submittedRank/reportedBy/reviewedBy) in the same query -
   * Postgres rejects `FOR UPDATE` on the nullable side of the LEFT JOINs
   * those produce ("FOR UPDATE cannot be applied to the nullable side of
   * an outer join"). Splitting into lock-then-populate sidesteps that
   * entirely: the row is already locked by the time population runs, so
   * no second lock is needed for it.
   */
  private async loadForReview(
    em: EntityManager,
    sectionId: string,
    requestId: string,
    populate: string[],
  ): Promise<FormalRankCorrectionRequest | null> {
    const request = await em.findOne(
      FormalRankCorrectionRequest,
      { id: requestId, section: sectionId },
      { lockMode: LockMode.PESSIMISTIC_WRITE },
    );
    if (!request) {
      return null;
    }
    await em.populate(request, populate as never);
    return request;
  }

  private async loadByIdOrFail(
    em: EntityManager,
    sectionId: string,
    requestId: string,
  ): Promise<FormalRankCorrectionRequest> {
    const request = await em.findOne(
      FormalRankCorrectionRequest,
      { id: requestId, section: sectionId },
      { populate: [...REQUEST_POPULATE] },
    );
    if (!request) {
      throw this.correctionNotFound();
    }
    return request;
  }

  private assertPendingApproval(
    request: FormalRankCorrectionRequest,
    attemptedAction: 'approved' | 'rejected',
  ): void {
    if (request.status !== FormalRankCorrectionStatus.PENDING_APPROVAL) {
      throw new ConflictException({
        code: 'CORRECTION_NOT_PENDING',
        message: `This request is ${request.status.toLowerCase()} and cannot be ${attemptedAction}`,
      });
    }
  }

  private userNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  }

  private correctionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'FORMAL_RANK_CORRECTION_NOT_FOUND',
      message: 'Formal rank correction request not found',
    });
  }

  private noActiveCorrection(): NotFoundException {
    return new NotFoundException({
      code: 'NO_ACTIVE_CORRECTION',
      message: 'No active formal rank correction request',
    });
  }

  private correctionAlreadyActive(): ConflictException {
    return new ConflictException({
      code: 'CORRECTION_ALREADY_ACTIVE',
      message:
        'An active correction request already exists for this formal rank',
    });
  }
}
