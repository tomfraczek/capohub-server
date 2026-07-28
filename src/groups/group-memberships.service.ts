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
import { GroupMembershipResponseDto } from './dto/group-membership-response.dto';
import { TransferOwnershipInput } from './dto/transfer-ownership.schema';
import { TransferOwnershipResponseDto } from './dto/transfer-ownership-response.dto';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { MembershipEndReason } from './enums/membership-end-reason.enum';
import { CohortStatus } from './enums/cohort-status.enum';
import {
  GROUP_BANS_ACTIVE_UNIQUE_INDEX,
  GroupBan,
} from './entities/group-ban.entity';
import {
  GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  GroupMembership,
} from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { MembershipCohort } from './entities/membership-cohort.entity';
import {
  MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX,
  MembershipSuspension,
} from './entities/membership-suspension.entity';
import { Cohort } from './entities/cohort.entity';
import { GroupHierarchyService } from './group-hierarchy.service';
import { loadActiveMembership } from './group-membership.query';
import {
  toGroupMembershipResponseDto,
  toMembershipCohortRefDto,
} from './mappers/group.mapper';
import { RoleAssignmentsService } from './role-assignments.service';

const MEMBERSHIP_COHORTS_UNIQUE_INDEX =
  'membership_cohorts_membership_id_cohort_id_unique';

@Injectable()
export class GroupMembershipsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  async listMembers(
    rootGroupId: string,
  ): Promise<GroupMembershipResponseDto[]> {
    const memberships = await this.em.find(
      GroupMembership,
      { rootGroup: rootGroupId, status: GroupMembershipStatus.ACTIVE },
      { populate: ['user'], orderBy: { joinedAt: 'asc' } },
    );

    return this.toResponseDtos(rootGroupId, memberships);
  }

  // A membership that has ended remains available by id as history (see
  // organization-entities.md#membership) - unlike listMembers, this is not
  // filtered to ACTIVE.
  async getMembership(
    rootGroupId: string,
    membershipId: string,
  ): Promise<GroupMembershipResponseDto> {
    const membership = await this.loadMembershipByIdOrFail(
      this.em,
      rootGroupId,
      membershipId,
    );
    return this.toResponseDto(rootGroupId, membership);
  }

  // "Technical" add only - no invitation/acceptance flow (spec section
  // "Dodanie członka"). OWNER can never be assigned here - see
  // assignableGroupRoleSchema. Membership represents only "does this User
  // belong to this organization" and by itself creates no Role Assignment
  // - not even MEMBER (see ADR-028/ADR-004: the Root Group is a Group like
  // any other, and joining the organization is a separate fact from
  // holding any Role in its Root Group). rootGroupId must reference an
  // actual Root Group (see organization-entities.md#membership), never a
  // Child Group.
  //
  // `input.role` is optional: if omitted, this call creates only the
  // Membership - the User belongs to the organization but is not yet
  // assigned to any Group, a valid and supported state. If provided, this
  // additionally grants that Role for the Root Group itself, through the
  // same "first Role in a Group grants MEMBER too" mechanism used
  // everywhere else (see RoleAssignmentsService.ensureMemberRole) - not a
  // Root-Group-specific rule.
  async addMember(
    rootGroupId: string,
    input: AddMemberInput,
  ): Promise<GroupMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const rootGroup = await em.findOne(Group, { id: rootGroupId });
      if (!rootGroup) {
        throw this.groupNotFound();
      }
      if (rootGroup.parentGroup) {
        throw new BadRequestException({
          code: 'MEMBERSHIP_ROOT_GROUP_MISMATCH',
          message: 'Membership can only be created for a Root Group',
        });
      }

      const user = await em.findOne(User, { id: input.userId });
      if (!user) {
        throw new BadRequestException({
          code: 'USER_NOT_FOUND',
          message: 'No user exists with the given userId',
        });
      }

      const existing = await loadActiveMembership(
        em,
        rootGroupId,
        input.userId,
      );
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_A_MEMBER',
          message: 'This user is already an active member of the group',
        });
      }

      const membership = new GroupMembership();
      membership.rootGroup = rootGroup;
      membership.user = user;
      membership.joinedAt = new Date();

      try {
        em.persist(membership);
        if (input.role !== undefined) {
          if (input.role !== GroupRole.MEMBER) {
            await this.roleAssignmentsService.ensureMemberRole(
              em,
              membership,
              rootGroup,
            );
          }
          await this.roleAssignmentsService.insertRoleAssignment(
            em,
            membership,
            rootGroup,
            input.role,
          );
        }
      } catch (error) {
        // Race: two concurrent adds for the same user both passed the
        // loadActiveMembership check above before either flushed. The
        // partial unique index on group_memberships (see its entity) is the
        // database-level backstop for exactly this - surfaced as the same
        // conflict the app-level check above would have raised.
        if (isUniqueViolationOn(error, GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'ALREADY_A_MEMBER',
            message: 'This user is already an active member of the group',
          });
        }
        throw error;
      }

      return this.toResponseDto(rootGroupId, membership, em);
    });
  }

  // Ends the Membership because the organization removed the member -
  // never a hard delete (ADR-007). Distinguished from a self-service
  // leave() only by `endReason`, since the documented status set has no
  // separate REMOVED state (see GroupMembershipStatus). The member's Role
  // Assignments (for this Root Group and any Child Group in its tree) are
  // left in place - they simply expire logically the instant this
  // Membership is no longer ACTIVE (see ADR-028).
  //
  // Runs inside a transaction with the Membership row locked
  // (PESSIMISTIC_WRITE) for the same reason leave() does - see
  // assertOwnsNoActiveGroups.
  async removeMember(
    rootGroupId: string,
    membershipId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadActiveMembershipByIdOrFail(
        em,
        rootGroupId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      await this.assertOwnsNoActiveGroups(em, membership, rootGroupId, {
        code: 'CANNOT_REMOVE_OWNER',
        message:
          'This member owns one or more Groups in this Group - transfer ownership of each before removing them',
      });

      membership.status = GroupMembershipStatus.ARCHIVED;
      membership.leftAt = new Date();
      membership.endReason = MembershipEndReason.REMOVED;
      this.auditLogService.record(em, {
        community: membership.rootGroup,
        action: AuditAction.REMOVE_MEMBER,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
      });
      await em.flush();
    });
  }

  // Self-service leave - any member (including, per spec, everyone except
  // an OWNER, who must transfer ownership of every Group they own - Root
  // or Child - first) may end their own Membership without an
  // administrative permission.
  //
  // Runs inside a transaction with the Membership row locked
  // (PESSIMISTIC_WRITE) - see assertOwnsNoActiveGroups for why: it
  // serializes against a concurrent transferOwnership() that might be
  // about to name this same Membership the new owner of some Group,
  // which would otherwise leave that Group owned by a Membership this
  // call just archived.
  async leave(rootGroupId: string, actor: User): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await loadActiveMembership(em, rootGroupId, actor.id, {
        lockMode: LockMode.PESSIMISTIC_WRITE,
      });
      if (!membership) {
        throw this.membershipNotFound();
      }
      await this.assertOwnsNoActiveGroups(em, membership, rootGroupId, {
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
        message:
          'Transfer ownership of every Group you own in this Group before leaving',
      });

      membership.status = GroupMembershipStatus.ARCHIVED;
      membership.leftAt = new Date();
      membership.endReason = MembershipEndReason.LEFT;
      this.auditLogService.record(em, {
        community: membership.rootGroup,
        action: AuditAction.LEAVE_COMMUNITY,
        actor,
        targetType: AuditTargetType.USER,
        targetId: actor.id,
      });
      await em.flush();
    });
  }

  // Atomic transfer: the previous owner's OWNER Role Assignment is removed
  // and the new owner's is created in the same transaction, so no other
  // request ever observes a Group with zero or two active OWNERs (the
  // ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX partial unique index is the
  // database-level backstop for this). The previous owner loses *only*
  // the OWNER Role Assignment - every other Role they hold (MEMBER, ADMIN,
  // ...) is left completely untouched (see ADR-028).
  //
  // `groupId` is the Group whose ownership is moving - Root or Child (see
  // ADR-013/ADR-028: OWNER, like every Role, is scoped per-Group, never
  // just the Root Group). Membership itself is always Root-Group-scoped
  // though, so both the previous and new owner's Membership are looked up
  // against that Group's Root Group, not `groupId` directly - only the
  // Role Assignment rows (found/inserted/removed below) target the exact
  // Group.
  //
  // Both Membership rows are loaded with PESSIMISTIC_WRITE, serializing
  // against a concurrent leave()/removeMember() naming either Membership -
  // see loadActiveMembership and assertOwnsNoActiveGroups.
  async transferOwnership(
    groupId: string,
    currentOwnerUserId: string,
    input: TransferOwnershipInput,
    actor: User,
  ): Promise<TransferOwnershipResponseDto> {
    if (input.newOwnerUserId === currentOwnerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_TRANSFER_TO_SELF',
        message: 'newOwnerUserId must be a different member',
      });
    }

    return this.em.transactional(async (em) => {
      const group = await em.findOne(Group, { id: groupId });
      if (!group) {
        throw this.groupNotFound();
      }
      const rootGroupId = group.parentGroup
        ? (await this.groupHierarchyService.getRootGroup(group.id, em)).id
        : group.id;

      const previousOwnerMembership = await loadActiveMembership(
        em,
        rootGroupId,
        currentOwnerUserId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!previousOwnerMembership) {
        throw this.membershipNotFound();
      }
      const previousOwnerAssignment =
        await this.roleAssignmentsService.findRoleAssignment(
          em,
          previousOwnerMembership.id,
          group.id,
          GroupRole.OWNER,
        );
      if (!previousOwnerAssignment) {
        throw this.membershipNotFound();
      }

      const newOwnerMembership = await loadActiveMembership(
        em,
        rootGroupId,
        input.newOwnerUserId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (!newOwnerMembership) {
        throw new BadRequestException({
          code: 'TARGET_NOT_A_MEMBER',
          message:
            'newOwnerUserId must already be an active member of the group',
        });
      }

      await em.remove(previousOwnerAssignment).flush();
      // The new owner may never have held any Role for this Group before
      // (Membership no longer implies MEMBER there - see ADR-028/ADR-004)
      // - receiving OWNER is their first Role for this Group, so MEMBER
      // must be granted alongside it, exactly like any other Group. A
      // no-op only when they already held some Role here.
      await this.roleAssignmentsService.ensureMemberRole(
        em,
        newOwnerMembership,
        group,
      );
      await this.roleAssignmentsService.insertRoleAssignment(
        em,
        newOwnerMembership,
        group,
        GroupRole.OWNER,
      );

      const auditCommunity = group.parentGroup
        ? await this.groupHierarchyService.getRootGroup(group.id, em)
        : group;
      this.auditLogService.record(em, {
        community: auditCommunity,
        action: AuditAction.TRANSFER_OWNERSHIP,
        actor,
        targetType: AuditTargetType.USER,
        targetId: input.newOwnerUserId,
        metadata: { groupId, previousOwnerUserId: currentOwnerUserId },
      });
      await em.flush();

      return {
        previousOwner: await this.toResponseDto(
          rootGroupId,
          previousOwnerMembership,
          em,
        ),
        newOwner: await this.toResponseDto(rootGroupId, newOwnerMembership, em),
      };
    });
  }

  // Assigning a Cohort requires the Membership to be ACTIVE, and the
  // Cohort to belong to the same Root Group as the Membership (it may
  // belong to any Group within that organization's tree - see
  // GroupHierarchyService.getRootGroup) and not be archived. See
  // organization-entities.md#cohort.
  async assignCohort(
    rootGroupId: string,
    membershipId: string,
    cohortId: string,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        rootGroupId,
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

      const cohortRoot = await this.groupHierarchyService.getRootGroup(
        cohort.group.id,
        em,
      );
      if (cohortRoot.id !== rootGroupId) {
        throw new BadRequestException({
          code: 'MEMBERSHIP_COHORT_MISMATCH',
          message: "This cohort does not belong to the membership's Root Group",
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
      assignment.membership = em.getReference(GroupMembership, membershipId);
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
    rootGroupId: string,
    membershipId: string,
    cohortId: string,
  ): Promise<void> {
    await this.loadMembershipByIdOrFail(this.em, rootGroupId, membershipId);

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
   * Ends the Membership (like removeMember) and additionally records a
   * durable GroupBan, which blocks the user from rejoining or being
   * re-invited to this Group until explicitly unbanned (see
   * GroupBan, MembershipRequestsService.assertNotBanned). Scoped to the
   * Group (Root Group) only - see GroupBan's own comment for why
   * there is no per-Child-Group ban.
   *
   * Same ownership guard as removeMember: a member who currently owns any
   * Group in this Group's tree cannot be banned until ownership is
   * transferred - banning is a stronger form of removal, so it inherits
   * every restriction removal already has.
   */
  async banMember(
    rootGroupId: string,
    membershipId: string,
    actor: User,
    reason: string | null,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadActiveMembershipByIdOrFail(
        em,
        rootGroupId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      await this.assertOwnsNoActiveGroups(em, membership, rootGroupId, {
        code: 'CANNOT_BAN_OWNER',
        message:
          'This member owns one or more Groups in this Group - transfer ownership of each before banning them',
      });

      membership.status = GroupMembershipStatus.ARCHIVED;
      membership.leftAt = new Date();
      membership.endReason = MembershipEndReason.BANNED;

      const ban = new GroupBan();
      ban.rootGroup = membership.rootGroup;
      ban.user = membership.user;
      ban.bannedBy = actor;
      ban.bannedAt = new Date();
      ban.reason = reason;

      try {
        em.persist(ban);
        await em.flush();
      } catch (error) {
        if (isUniqueViolationOn(error, GROUP_BANS_ACTIVE_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'ALREADY_BANNED',
            message: 'This user is already banned from this organization',
          });
        }
        throw error;
      }

      this.auditLogService.record(em, {
        community: membership.rootGroup,
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
   * Lifts an active ban - does not restore the Membership itself (banning
   * is a terminal action for that Membership stint, same as removeMember;
   * a returning user rejoins through the normal join/invite flow, which
   * assertNotBanned now permits again).
   */
  async unbanMember(
    rootGroupId: string,
    membershipId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        rootGroupId,
        membershipId,
      );

      const ban = await em.findOne(GroupBan, {
        rootGroup: rootGroupId,
        user: membership.user.id,
        liftedAt: null,
      });
      if (!ban) {
        throw new NotFoundException({
          code: 'BAN_NOT_FOUND',
          message: 'This user is not currently banned from this organization',
        });
      }
      ban.liftedAt = new Date();
      ban.liftedBy = actor;

      this.auditLogService.record(em, {
        community: membership.rootGroup,
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
   * Suspends an active Membership - sets its status to READ_ONLY (see
   * organization-entities.md#membership: "READ_ONLY ... e.g. suspended
   * member"), which the existing permission system already resolves
   * correctly with no further change (GroupPermissionService,
   * READ_ONLY_SAFE_PERMISSIONS): a suspended member, regardless of Role,
   * keeps only the *_VIEW tier of permissions - including a suspended
   * OWNER, who is not specially protected here (unlike Ban/Remove/Leave,
   * suspension never ends the Membership, so there is no "Group left
   * ownerless" risk to guard against).
   *
   * `until` is optional - null means an indefinite suspension. There is no
   * background job to auto-expire it (see MembershipSuspension); expiry is
   * resolved lazily the next time this Membership's authorization is
   * checked (RoleAssignmentsService.resolveAuthorization).
   */
  async suspendMember(
    rootGroupId: string,
    membershipId: string,
    actor: User,
    until: Date | null,
    reason: string | null,
  ): Promise<GroupMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadActiveMembershipByIdOrFail(
        em,
        rootGroupId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );

      membership.status = GroupMembershipStatus.READ_ONLY;

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
        community: membership.rootGroup,
        action: AuditAction.SUSPEND,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
        description: reason ?? undefined,
        metadata: { until: until ? until.toISOString() : null },
      });
      await em.flush();

      return this.toResponseDto(rootGroupId, membership, em);
    });
  }

  async unsuspendMember(
    rootGroupId: string,
    membershipId: string,
    actor: User,
  ): Promise<GroupMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        rootGroupId,
        membershipId,
        { lockMode: LockMode.PESSIMISTIC_WRITE },
      );
      if (membership.status !== GroupMembershipStatus.READ_ONLY) {
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

      membership.status = GroupMembershipStatus.ACTIVE;
      suspension.liftedAt = new Date();
      suspension.liftedBy = actor;

      this.auditLogService.record(em, {
        community: membership.rootGroup,
        action: AuditAction.UNSUSPEND,
        actor,
        targetType: AuditTargetType.USER,
        targetId: membership.user.id,
      });
      await em.flush();

      return this.toResponseDto(rootGroupId, membership, em);
    });
  }

  private assertMembershipIsActive(membership: GroupMembership): void {
    if (membership.status !== GroupMembershipStatus.ACTIVE) {
      throw new ConflictException({
        code: 'MEMBERSHIP_NOT_ACTIVE',
        message: 'This operation requires an active membership',
      });
    }
  }

  private async loadActiveMembershipByIdOrFail(
    em: EntityManager,
    rootGroupId: string,
    membershipId: string,
    options: { lockMode?: LockMode } = {},
  ): Promise<GroupMembership> {
    const membership = await em.findOne(
      GroupMembership,
      {
        id: membershipId,
        rootGroup: rootGroupId,
        status: GroupMembershipStatus.ACTIVE,
      },
      { populate: ['user'], ...options },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  // Shared by leave() and removeMember() - the one place that decides
  // whether a Membership may end. Group-wide: checks the Root
  // Group and every Child Group beneath it (see
  // RoleAssignmentsService.findOwnedActiveGroups), not just the Root
  // Group the Membership itself is scoped to - a Membership can hold
  // OWNER for any Child Group without ever holding it for the Root Group
  // (see ADR-013/ADR-028). Must be called after the Membership row has
  // been loaded with a PESSIMISTIC_WRITE lock in the same transaction, so
  // a concurrent transferOwnership() naming this Membership the new owner
  // of some Group cannot race past this check undetected.
  private async assertOwnsNoActiveGroups(
    em: EntityManager,
    membership: GroupMembership,
    rootGroupId: string,
    error: { code: string; message: string },
  ): Promise<void> {
    const ownedGroups = await this.roleAssignmentsService.findOwnedActiveGroups(
      em,
      membership.id,
      rootGroupId,
    );
    if (ownedGroups.length > 0) {
      throw new ConflictException({
        ...error,
        ownedGroupIds: ownedGroups.map((group) => group.id),
      });
    }
  }

  // Unlike loadActiveMembershipByIdOrFail, does not filter by status - a
  // membership that has ended is still a valid target for getMembership()
  // and for the membership-status checks in assignCohort/unassignCohort
  // (which need to distinguish "not found" from "found but not active").
  // Also used by unbanMember/unsuspendMember, which by definition target a
  // Membership that is no longer ACTIVE (ARCHIVED for a ban, READ_ONLY for
  // a suspension).
  private async loadMembershipByIdOrFail(
    em: EntityManager,
    rootGroupId: string,
    membershipId: string,
    options: { lockMode?: LockMode } = {},
  ): Promise<GroupMembership> {
    const membership = await em.findOne(
      GroupMembership,
      { id: membershipId, rootGroup: rootGroupId },
      { populate: ['user'], ...options },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  private async toResponseDto(
    rootGroupId: string,
    membership: GroupMembership,
    em: EntityManager = this.em,
  ): Promise<GroupMembershipResponseDto> {
    const [cohorts, rootRoleAssignments] = await Promise.all([
      this.loadCohortRefs(em, [membership.id]),
      this.roleAssignmentsService.getRoleAssignmentsForMembership(
        em,
        membership.id,
        rootGroupId,
      ),
    ]);
    return toGroupMembershipResponseDto(
      membership,
      rootRoleAssignments.map((roleAssignment) => roleAssignment.role),
      cohorts.get(membership.id) ?? [],
    );
  }

  private async toResponseDtos(
    rootGroupId: string,
    memberships: GroupMembership[],
  ): Promise<GroupMembershipResponseDto[]> {
    const [cohortsByMembership, rootRoles] = await Promise.all([
      this.loadCohortRefs(
        this.em,
        memberships.map((membership) => membership.id),
      ),
      this.roleAssignmentsService.getRoleAssignmentsForGroup(
        memberships.map((membership) => membership.id),
        rootGroupId,
      ),
    ]);
    return memberships.map((membership) =>
      toGroupMembershipResponseDto(
        membership,
        rootRoles.get(membership.id) ?? [],
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

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  private membershipNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEMBERSHIP_NOT_FOUND',
      message: 'Group membership not found',
    });
  }
}
