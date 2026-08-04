import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { AddMemberInput } from './dto/add-member.schema';
import { SectionMembershipResponseDto } from './dto/section-membership-response.dto';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { MembershipEndReason } from './enums/membership-end-reason.enum';
import { CohortStatus } from './enums/cohort-status.enum';
import {
  SECTION_BANS_ACTIVE_UNIQUE_INDEX,
  SectionBan,
} from './entities/section-ban.entity';
import {
  SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  SectionMembership,
} from './entities/section-membership.entity';
import { Section } from './entities/section.entity';
import { MembershipCohort } from './entities/membership-cohort.entity';
import {
  MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX,
  MembershipSuspension,
} from './entities/membership-suspension.entity';
import { Cohort } from './entities/cohort.entity';
import { GroupHierarchyService } from './group-hierarchy.service';
import { loadActiveSectionMembership } from './section-membership.query';
import {
  toSectionMembershipResponseDto,
  toMembershipCohortRefDto,
} from './mappers/group.mapper';
import { RoleAssignmentsService } from './role-assignments.service';

const MEMBERSHIP_COHORTS_UNIQUE_INDEX =
  'membership_cohorts_membership_id_cohort_id_unique';

// Section is the only place membership exists - Group has none at all (see
// the organizational-domain rebuild). Every method here is Section-scoped;
// there is no Group equivalent, and none of Group's administration
// (OWNER/ADMIN, granted via RoleAssignmentsController/transferOwnership)
// goes through this service.
@Injectable()
export class SectionMembershipsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listMembers(
    sectionId: string,
  ): Promise<SectionMembershipResponseDto[]> {
    const memberships = await this.em.find(
      SectionMembership,
      { section: sectionId, status: SectionMembershipStatus.ACTIVE },
      { populate: ['user'], orderBy: { joinedAt: 'asc' } },
    );

    return this.toResponseDtos(sectionId, memberships);
  }

  // A membership that has ended remains available by id as history - unlike
  // listMembers, this is not filtered to ACTIVE.
  async getMembership(
    sectionId: string,
    membershipId: string,
  ): Promise<SectionMembershipResponseDto> {
    const membership = await this.loadMembershipByIdOrFail(
      this.em,
      sectionId,
      membershipId,
    );
    return this.toResponseDto(sectionId, membership);
  }

  // "Technical" add only - no invitation/acceptance flow (join/invite go
  // through MembershipRequestsService instead). OWNER can never be
  // assigned here - see assignableSectionRoleSchema. Every add creates the
  // SectionMembership *and* its base MEMBER Role Assignment together,
  // atomically - a Section membership never exists without MEMBER (see
  // role-assignment.entity.ts). `input.role`, if provided and not MEMBER
  // itself, additionally grants that Role in the same transaction.
  async addMember(
    sectionId: string,
    input: AddMemberInput,
    actor: User,
  ): Promise<SectionMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await em.findOne(Section, { id: sectionId });
      if (!section) {
        throw this.sectionNotFound();
      }

      const user = await em.findOne(User, { id: input.userId });
      if (!user) {
        throw new BadRequestException({
          code: 'USER_NOT_FOUND',
          message: 'No user exists with the given userId',
        });
      }

      const existing = await loadActiveSectionMembership(
        em,
        sectionId,
        input.userId,
      );
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_A_MEMBER',
          message: 'This user is already an active member of the section',
        });
      }

      const membership = new SectionMembership();
      membership.section = section;
      membership.user = user;
      membership.joinedAt = new Date();

      try {
        em.persist(membership);
        await this.roleAssignmentsService.insertRoleAssignment(
          em,
          user,
          section,
          GroupRole.MEMBER,
          actor,
        );
        if (input.role && input.role !== GroupRole.MEMBER) {
          await this.roleAssignmentsService.insertRoleAssignment(
            em,
            user,
            section,
            input.role,
            actor,
          );
        }
      } catch (error) {
        // Race: two concurrent adds for the same user both passed the
        // loadActiveSectionMembership check above before either flushed.
        // The partial unique index on section_memberships (see its entity)
        // is the database-level backstop for exactly this.
        if (
          isUniqueViolationOn(error, SECTION_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX)
        ) {
          throw new ConflictException({
            code: 'ALREADY_A_MEMBER',
            message: 'This user is already an active member of the section',
          });
        }
        throw error;
      }

      return this.toResponseDto(sectionId, membership, em);
    });
  }

  // Ends the membership because an admin removed the member - never a hard
  // delete. Distinguished from a self-service leave() only by `endReason`.
  // Every currently-active Role Assignment this user holds for this
  // Section (MEMBER and any additional Role) is revoked in the same
  // transaction (see RoleAssignmentsService.revokeAllForEndedMembership) -
  // ending a membership must never leave any Role with active authority.
  async removeMember(
    sectionId: string,
    membershipId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadActiveMembershipByIdOrFail(
        em,
        sectionId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      await this.assertNotActiveOwner(em, membership, sectionId, {
        code: 'CANNOT_REMOVE_OWNER',
        message:
          'This member owns this Section - transfer ownership before removing them',
      });

      membership.status = SectionMembershipStatus.ARCHIVED;
      membership.leftAt = new Date();
      membership.endReason = MembershipEndReason.REMOVED;
      membership.endedBy = actor;
      await this.roleAssignmentsService.revokeAllForEndedMembership(
        em,
        membership.user,
        membership.section,
        actor,
      );

      this.auditLogService.record(em, {
        community: membership.section,
        action: AuditAction.REMOVE_MEMBER,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
      });
      await em.flush();
    });
  }

  // Self-service leave - any member (except an active OWNER, who must
  // transfer ownership first - see assertNotActiveOwner) may end their own
  // membership without an administrative permission.
  //
  // Runs inside a transaction with the membership row locked
  // (PESSIMISTIC_WRITE) - serializes against a concurrent
  // transferOwnership() that might be about to name this same membership
  // the new owner of the Section, which would otherwise leave the Section
  // owned by a membership this call just archived.
  async leave(sectionId: string, actor: User): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await loadActiveSectionMembership(
        em,
        sectionId,
        actor.id,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!membership) {
        throw this.membershipNotFound();
      }
      await this.assertNotActiveOwner(em, membership, sectionId, {
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
        message: 'Transfer ownership of this Section before leaving',
      });

      membership.status = SectionMembershipStatus.ARCHIVED;
      membership.leftAt = new Date();
      membership.endReason = MembershipEndReason.LEFT;
      membership.endedBy = actor;
      await this.roleAssignmentsService.revokeAllForEndedMembership(
        em,
        membership.user,
        membership.section,
        actor,
      );

      this.auditLogService.record(em, {
        community: membership.section,
        action: AuditAction.LEAVE_COMMUNITY,
        actor,
        targetType: AuditTargetType.USER,
        targetId: actor.id,
      });
      await em.flush();
    });
  }

  // Assigning a Cohort requires the membership to be ACTIVE, and the
  // Cohort to belong to the same organization tree as the Section (any
  // level - resolved via each side's root Group) and not be archived.
  async assignCohort(
    sectionId: string,
    membershipId: string,
    cohortId: string,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        sectionId,
        membershipId,
      );
      this.assertMembershipIsActive(membership);

      const cohort = await em.findOne(Cohort, { id: cohortId });
      if (!cohort) {
        throw new NotFoundException({
          code: 'COHORT_NOT_FOUND',
          message: 'Cohort not found',
        });
      }
      if (cohort.status === CohortStatus.ARCHIVED) {
        throw new ConflictException({
          code: 'MEMBERSHIP_COHORT_ARCHIVED',
          message: 'This cohort is archived and cannot accept new members',
        });
      }

      const [sectionRoot, cohortRoot] = await Promise.all([
        this.groupHierarchyService.resolveRootGroup(membership.section, em),
        this.groupHierarchyService.resolveRootGroup(
          (cohort.group ?? cohort.section)!,
          em,
        ),
      ]);
      if (sectionRoot.id !== cohortRoot.id) {
        throw new BadRequestException({
          code: 'MEMBERSHIP_COHORT_MISMATCH',
          message:
            "This cohort does not belong to the membership's organization",
        });
      }

      const existing = await em.findOne(MembershipCohort, {
        membership: membershipId,
        cohort: cohortId,
      });
      if (existing) {
        throw new ConflictException({
          code: 'MEMBERSHIP_COHORT_ALREADY_ASSIGNED',
          message: 'This member is already assigned to this cohort',
        });
      }

      const assignment = new MembershipCohort();
      assignment.membership = em.getReference(SectionMembership, membershipId);
      assignment.cohort = em.getReference(Cohort, cohortId);

      try {
        await em.persist(assignment).flush();
      } catch (error) {
        // Race backstop - see the equivalent comment in addMember().
        if (isUniqueViolationOn(error, MEMBERSHIP_COHORTS_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'MEMBERSHIP_COHORT_ALREADY_ASSIGNED',
            message: 'This member is already assigned to this cohort',
          });
        }
        throw error;
      }
    });
  }

  async unassignCohort(
    sectionId: string,
    membershipId: string,
    cohortId: string,
  ): Promise<void> {
    await this.loadMembershipByIdOrFail(this.em, sectionId, membershipId);

    const assignment = await this.em.findOne(MembershipCohort, {
      membership: membershipId,
      cohort: cohortId,
    });
    if (!assignment) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_COHORT_ASSIGNMENT_NOT_FOUND',
        message: 'This member is not assigned to this cohort',
      });
    }

    await this.em.remove(assignment).flush();
  }

  // ─── Ban / Unban ──────────────────────────────────────────────────────────

  /**
   * Ends the membership (like removeMember) and additionally records a
   * durable SectionBan, which blocks the user from rejoining or being
   * re-invited to this Section until explicitly unbanned. Same OWNER guard
   * as removeMember/leave.
   */
  async banMember(
    sectionId: string,
    membershipId: string,
    actor: User,
    reason: string | null,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadActiveMembershipByIdOrFail(
        em,
        sectionId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      await this.assertNotActiveOwner(em, membership, sectionId, {
        code: 'CANNOT_BAN_OWNER',
        message:
          'This member owns this Section - transfer ownership before banning them',
      });

      membership.status = SectionMembershipStatus.ARCHIVED;
      membership.leftAt = new Date();
      membership.endReason = MembershipEndReason.BANNED;
      membership.endedBy = actor;
      await this.roleAssignmentsService.revokeAllForEndedMembership(
        em,
        membership.user,
        membership.section,
        actor,
      );

      const ban = new SectionBan();
      ban.section = membership.section;
      ban.user = membership.user;
      ban.bannedBy = actor;
      ban.bannedAt = new Date();
      ban.reason = reason;

      try {
        em.persist(ban);
        await em.flush();
      } catch (error) {
        if (isUniqueViolationOn(error, SECTION_BANS_ACTIVE_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'ALREADY_BANNED',
            message: 'This user is already banned from this section',
          });
        }
        throw error;
      }

      this.auditLogService.record(em, {
        community: membership.section,
        action: AuditAction.BAN,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
        description: reason ?? undefined,
      });
      await em.flush();
    });
  }

  /**
   * Lifts an active ban - does not restore the membership itself (banning
   * is a terminal action for that membership stint, same as removeMember;
   * a returning user rejoins through the normal join/invite flow, which
   * assertNotBanned now permits again).
   */
  async unbanMember(
    sectionId: string,
    membershipId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        sectionId,
        membershipId,
      );

      const ban = await em.findOne(SectionBan, {
        section: sectionId,
        user: membership.user.id,
        liftedAt: null,
      });
      if (!ban) {
        throw new NotFoundException({
          code: 'BAN_NOT_FOUND',
          message: 'This user is not currently banned from this section',
        });
      }
      ban.liftedAt = new Date();
      ban.liftedBy = actor;

      this.auditLogService.record(em, {
        community: membership.section,
        action: AuditAction.UNBAN,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
      });
      await em.flush();
    });
  }

  // ─── Suspend / Unsuspend ────────────────────────────────────────────────

  /**
   * Suspends an active membership - sets its status to READ_ONLY, which
   * the permission system already resolves correctly with no further
   * change (GroupPermissionService, READ_ONLY_SAFE_PERMISSIONS): a
   * suspended member, regardless of Role, keeps only the *_VIEW tier of
   * permissions. Unlike Ban/Remove/Leave, suspension never sets
   * revokedAt/revokedBy on any Role Assignment - it is the same continuous
   * membership stint, just temporarily restricted (see
   * RoleAssignmentsService's own comment on this distinction).
   *
   * The active-OWNER guard still applies here (unlike the pre-rebuild
   * version of this method): a suspended OWNER would be left unable to act
   * for their own Section, so suspending the active OWNER is blocked the
   * same as ban/remove/leave - transfer ownership first.
   *
   * `until` is optional - null means an indefinite suspension. There is no
   * background job to auto-expire it; expiry is resolved lazily the next
   * time this membership's authorization is checked
   * (RoleAssignmentsService.resolveAuthorization).
   */
  async suspendMember(
    sectionId: string,
    membershipId: string,
    actor: User,
    until: Date | null,
    reason: string | null,
  ): Promise<SectionMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadActiveMembershipByIdOrFail(
        em,
        sectionId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      await this.assertNotActiveOwner(em, membership, sectionId, {
        code: 'CANNOT_SUSPEND_OWNER',
        message:
          'This member owns this Section - transfer ownership before suspending them',
      });

      membership.status = SectionMembershipStatus.READ_ONLY;

      const suspension = new MembershipSuspension();
      suspension.membership = membership;
      suspension.suspendedBy = actor;
      suspension.suspendedAt = new Date();
      suspension.until = until;
      suspension.reason = reason;

      try {
        em.persist(suspension);
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX)
        ) {
          throw new ConflictException({
            code: 'MEMBERSHIP_ALREADY_SUSPENDED',
            message: 'This membership is already suspended',
          });
        }
        throw error;
      }

      this.auditLogService.record(em, {
        community: membership.section,
        action: AuditAction.SUSPEND,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
        description: reason ?? undefined,
        metadata: { until: until ? until.toISOString() : null },
      });
      await em.flush();

      return this.toResponseDto(sectionId, membership, em);
    });
  }

  async unsuspendMember(
    sectionId: string,
    membershipId: string,
    actor: User,
  ): Promise<SectionMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        sectionId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (membership.status !== SectionMembershipStatus.READ_ONLY) {
        throw new ConflictException({
          code: 'MEMBERSHIP_NOT_SUSPENDED',
          message: 'This membership is not currently suspended',
        });
      }

      const suspension = await em.findOne(MembershipSuspension, {
        membership: membershipId,
        liftedAt: null,
      });
      if (!suspension) {
        throw new NotFoundException({
          code: 'SUSPENSION_NOT_FOUND',
          message: 'No active suspension found for this membership',
        });
      }

      membership.status = SectionMembershipStatus.ACTIVE;
      suspension.liftedAt = new Date();
      suspension.liftedBy = actor;

      this.auditLogService.record(em, {
        community: membership.section,
        action: AuditAction.UNSUSPEND,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
      });
      await em.flush();

      return this.toResponseDto(sectionId, membership, em);
    });
  }

  private assertMembershipIsActive(membership: SectionMembership): void {
    if (membership.status !== SectionMembershipStatus.ACTIVE) {
      throw new ConflictException({
        code: 'MEMBERSHIP_NOT_ACTIVE',
        message: 'This operation requires an active membership',
      });
    }
  }

  private async loadActiveMembershipByIdOrFail(
    em: EntityManager,
    sectionId: string,
    membershipId: string,
    options: { lockMode?: LockMode } = {},
  ): Promise<SectionMembership> {
    const membership = await em.findOne(
      SectionMembership,
      {
        id: membershipId,
        section: sectionId,
        status: SectionMembershipStatus.ACTIVE,
      },
      { populate: ['user', 'section'], ...options },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  // Shared by leave()/removeMember()/banMember()/suspendMember() - the one
  // place that decides whether a membership may end (or be suspended)
  // while its user is the Section's active OWNER. Every Section must
  // always have exactly one active OWNER - none of these operations may
  // run against the OWNER until ownership has been transferred to someone
  // else first (see RoleAssignmentsService.transferOwnership). Must be
  // called after the membership row has been loaded with a
  // PESSIMISTIC_WRITE lock in the same transaction, so a concurrent
  // transferOwnership() naming this user cannot race past this check
  // undetected.
  private async assertNotActiveOwner(
    em: EntityManager,
    membership: SectionMembership,
    sectionId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    const isOwner = await this.roleAssignmentsService.hasRole(
      em,
      membership.user.id,
      sectionId,
      GroupRole.OWNER,
    );
    if (isOwner) {
      throw new ConflictException(error);
    }
  }

  // Unlike loadActiveMembershipByIdOrFail, does not filter by status - a
  // membership that has ended is still a valid target for getMembership()
  // and for the membership-status checks in assignCohort/unassignCohort.
  // Also used by unbanMember/unsuspendMember, which by definition target a
  // membership that is no longer ACTIVE (ARCHIVED for a ban, READ_ONLY for
  // a suspension).
  private async loadMembershipByIdOrFail(
    em: EntityManager,
    sectionId: string,
    membershipId: string,
    options: { lockMode?: LockMode } = {},
  ): Promise<SectionMembership> {
    const membership = await em.findOne(
      SectionMembership,
      { id: membershipId, section: sectionId },
      { populate: ['user', 'section'], ...options },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  private async toResponseDto(
    sectionId: string,
    membership: SectionMembership,
    em: EntityManager = this.em,
  ): Promise<SectionMembershipResponseDto> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager corrupt the underlying pg connection.
    const cohorts = await this.loadCohortRefs(em, [membership.id]);
    const roleAssignments =
      await this.roleAssignmentsService.getRoleAssignmentsForUser(
        em,
        membership.user.id,
        sectionId,
      );
    return toSectionMembershipResponseDto(
      membership,
      roleAssignments.map((roleAssignment) => roleAssignment.role),
      cohorts.get(membership.id) ?? [],
    );
  }

  private async toResponseDtos(
    sectionId: string,
    memberships: SectionMembership[],
  ): Promise<SectionMembershipResponseDto[]> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager corrupt the underlying pg connection.
    const cohortsByMembership = await this.loadCohortRefs(
      this.em,
      memberships.map((membership) => membership.id),
    );
    const rolesByUser =
      await this.roleAssignmentsService.getRoleAssignmentsForTarget(
        memberships.map((membership) => membership.user.id),
        sectionId,
      );
    return memberships.map((membership) =>
      toSectionMembershipResponseDto(
        membership,
        rolesByUser.get(membership.user.id) ?? [],
        cohortsByMembership.get(membership.id) ?? [],
      ),
    );
  }

  private async loadCohortRefs(
    em: EntityManager,
    membershipIds: string[],
  ): Promise<Map<string, ReturnType<typeof toMembershipCohortRefDto>[]>> {
    if (membershipIds.length === 0) {
      return new Map();
    }

    const assignments = await em.find(
      MembershipCohort,
      { membership: { $in: membershipIds } },
      { populate: ['cohort'] },
    );

    const byMembership = new Map<
      string,
      ReturnType<typeof toMembershipCohortRefDto>[]
    >();
    for (const assignment of assignments) {
      const membershipId = assignment.membership.id;
      const refs = byMembership.get(membershipId) ?? [];
      refs.push(toMembershipCohortRefDto(assignment.cohort));
      byMembership.set(membershipId, refs);
    }
    return byMembership;
  }

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }

  private membershipNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEMBERSHIP_NOT_FOUND',
      message: 'Section membership not found',
    });
  }
}
