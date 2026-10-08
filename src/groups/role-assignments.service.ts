import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, FilterQuery, LockMode } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { normalizeUserCodeInput } from '../common/utils/numeric-code';
import { resolveUserAvatarUrl } from '../storage/image-url.util';
import { R2StorageService } from '../storage/r2-storage.service';
import { resolveDisplayName } from '../users/display-name.util';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { CreateRoleAssignmentInput } from './dto/create-role-assignment.schema';
import { RoleAssignmentResponseDto } from './dto/role-assignment-response.dto';
import { OwnershipTransferCandidateDto } from './dto/ownership-transfer-candidate.dto';
import { GroupAdminCandidateDto } from './dto/group-admin-candidate.dto';
import { TransferOwnershipResponseDto } from './dto/transfer-ownership-response.dto';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { FormalGroupAffiliation } from './entities/formal-group-affiliation.entity';
import { MembershipSuspension } from './entities/membership-suspension.entity';
import {
  ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  RoleAssignment,
} from './entities/role-assignment.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import {
  Community,
  communityFilter,
  communityIdFilter,
  GroupHierarchyService,
} from './group-hierarchy.service';
import { toRoleAssignmentResponseDto } from './mappers/group.mapper';
import { getOwnershipTransferBlocker } from './owner-formal-group';

export interface ResolvedGroupAuthorization {
  community: Community;
  // `null` for a Group target - Group has no membership at all, so a held
  // RoleAssignment is unconditionally authoritative. Populated for a
  // Section target - its `status` gates whether/how the held roles below
  // currently translate to permissions (see GroupPermissionService).
  membership: SectionMembership | null;
  // Every currently-active (revokedAt === null) Role Assignment the user
  // holds for this exact Group-or-Section - never a single Role, since a
  // user may hold several at once (e.g. MEMBER + INSTRUCTOR + ADMIN
  // together).
  roleAssignments: RoleAssignment[];
}

// The single place that grants and revokes Role Assignments, and resolves
// "what authority does this user have, directly, for this exact
// Group-or-Section" - never inherited from a parent, a child, or a
// sibling. A Role Assignment is granted directly to a User, for exactly
// one target, with no relation to any membership at all - see
// role-assignment.entity.ts. GroupPermissionsGuard is the primary caller
// of resolveAuthorization(); GroupsService/SectionsService/
// SectionMembershipsService call the mutation methods for the
// creation-bootstrap and member-management flows they already own.
@Injectable()
export class RoleAssignmentsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly auditLogService: AuditLogService,
    private readonly r2StorageService: R2StorageService,
  ) {}

  /**
   * Resolves the caller's authorization for `groupOrSectionId` directly -
   * never inherited from a parent, a child, or a sibling. Branches by
   * target kind:
   *  - Group: a held RoleAssignment (revokedAt === null) is unconditionally
   *    authoritative - Group has no membership concept, so there is
   *    nothing to gate on.
   *  - Section: additionally requires an active (ACTIVE/READ_ONLY)
   *    SectionMembership for the same (user, section), found by an
   *    independent query - never a stored relation. Returns null if either
   *    the membership or every Role Assignment is missing.
   *
   * Accepts an optional `em` so callers running inside their own
   * `em.transactional(...)` callback can pass that forked EntityManager
   * through, rather than this reaching for `this.em` from inside someone
   * else's transaction.
   */
  async resolveAuthorization(
    groupOrSectionId: string,
    userId: string,
    em: EntityManager = this.em,
  ): Promise<ResolvedGroupAuthorization | null> {
    const community = await this.groupHierarchyService.findCommunityById(
      groupOrSectionId,
      em,
    );
    if (!community) {
      return null;
    }

    if (community instanceof Group) {
      const roleAssignments = await em.find(RoleAssignment, {
        user: userId,
        group: groupOrSectionId,
        revokedAt: null,
      });
      if (roleAssignments.length === 0) {
        return null;
      }
      return { community, membership: null, roleAssignments };
    }

    const membership = await em.findOne(SectionMembership, {
      section: groupOrSectionId,
      user: userId,
      status: {
        $in: [
          SectionMembershipStatus.ACTIVE,
          SectionMembershipStatus.READ_ONLY,
        ],
      },
    });
    if (!membership) {
      return null;
    }

    await this.reconcileExpiredSuspension(em, membership);

    const roleAssignments = await em.find(RoleAssignment, {
      user: userId,
      section: groupOrSectionId,
      revokedAt: null,
    });
    if (roleAssignments.length === 0) {
      return null;
    }

    return { community, membership, roleAssignments };
  }

  /**
   * Resolves the Public-view fallback: a Group or Section with
   * `isPublic = true` may be viewed (GroupPermission.GROUP_VIEW only -
   * see PUBLIC_VIEW_SAFE_PERMISSIONS) by ANY authenticated user, even one
   * holding no RoleAssignment/SectionMembership at all - otherwise
   * resolveAuthorization() above returns null for exactly that caller and
   * GroupPermissionsGuard 404s, which broke the "Discover" flow: a Public
   * Group/Section is findable via search, but tapping into it 404'd
   * before the caller could see anything to decide whether to join (see
   * DiscoverResultCard's own comment - "joining happens from the
   * destination screen" - and the mobile bug report this fixes).
   *
   * Deliberately returns the community (not a boolean) so the guard can
   * still run its Group-vs-Section kind check and lifecycle-status policy
   * against it, exactly as it does for a real RoleAssignment/Membership
   * hit. Returns `null` for a private target and for a target that
   * doesn't exist at all - never distinguishing the two, same as
   * resolveAuthorization, so a private id's mere existence is never
   * leaked to a non-member.
   */
  async resolvePublicView(
    groupOrSectionId: string,
    em: EntityManager = this.em,
  ): Promise<Community | null> {
    const community = await this.groupHierarchyService.findCommunityById(
      groupOrSectionId,
      em,
    );
    if (!community || !community.isPublic) {
      return null;
    }
    return community;
  }

  /**
   * Whether `userId` currently counts as "a member of" `communityId`:
   *  - Group: holds any active RoleAssignment there (OWNER/ADMIN - Group
   *    has no ordinary members, so this is really "administers this
   *    Group").
   *  - Section: has an active (ACTIVE/READ_ONLY) SectionMembership there -
   *    no Role required, mirroring "an ACTIVE membership with no extra
   *    Role is a normal, valid state" (every membership always carries at
   *    least MEMBER, but that is not re-verified here).
   * Used by RecipientGroupsService (validating a member add is in-scope)
   * and AnnouncementsService (GROUP/SECTION recipient visibility).
   */
  async isCommunityMember(
    communityId: string,
    userId: string,
    em: EntityManager = this.em,
  ): Promise<boolean> {
    const community = await this.groupHierarchyService.findCommunityById(
      communityId,
      em,
    );
    if (!community) {
      return false;
    }
    if (community instanceof Group) {
      const assignment = await em.findOne(RoleAssignment, {
        user: userId,
        group: communityId,
        revokedAt: null,
      });
      return assignment !== null;
    }
    const membership = await em.findOne(SectionMembership, {
      section: communityId,
      user: userId,
      status: {
        $in: [
          SectionMembershipStatus.ACTIVE,
          SectionMembershipStatus.READ_ONLY,
        ],
      },
    });
    return membership !== null;
  }

  /**
   * Bulk version of isCommunityMember() - which of `userIds` currently
   * count as a member of `communityId`, in one query instead of N. Used by
   * RecipientGroupsService.assertMembersInScope() so create/update
   * validation and findEligibleMembers() (the candidate-listing endpoint)
   * can never answer this question differently for the same input.
   */
  async findEligibleMemberIds(
    communityId: string,
    userIds: string[],
    em: EntityManager = this.em,
  ): Promise<Set<string>> {
    if (userIds.length === 0) {
      return new Set();
    }
    const community = await this.groupHierarchyService.findCommunityById(
      communityId,
      em,
    );
    if (!community) {
      return new Set();
    }

    if (community instanceof Group) {
      const assignments = await em.find(
        RoleAssignment,
        { user: { $in: userIds }, group: communityId, revokedAt: null },
        { fields: ['user'] },
      );
      return new Set(assignments.map((a) => a.user.id));
    }

    const memberships = await em.find(
      SectionMembership,
      {
        user: { $in: userIds },
        section: communityId,
        status: {
          $in: [
            SectionMembershipStatus.ACTIVE,
            SectionMembershipStatus.READ_ONLY,
          ],
        },
      },
      { fields: ['user'] },
    );
    return new Set(memberships.map((m) => m.user.id));
  }

  /**
   * Every User eligible to be added to a Recipient Group of `communityId` -
   * i.e. exactly the set findEligibleMemberIds() would accept - searchable
   * by `displayName` and paginated, sorted deterministically (displayName
   * ASC, id ASC, no configurable sort). Backs GET
   * .../recipient-groups/eligible-members.
   */
  async findEligibleMembers(
    communityId: string,
    options: { search?: string; limit: number; offset: number },
    em: EntityManager = this.em,
  ): Promise<{ items: User[]; total: number }> {
    const community = await this.groupHierarchyService.findCommunityById(
      communityId,
      em,
    );
    if (!community) {
      return { items: [], total: 0 };
    }

    if (community instanceof Group) {
      // Group's eligible-member pool is small by construction (only
      // OWNER/ADMIN) - a single unpaginated query plus in-memory
      // search/sort/paginate is simpler than a DISTINCT-users SQL query and
      // performs identically at this scale.
      const assignments = await em.find(
        RoleAssignment,
        { group: communityId, revokedAt: null },
        { populate: ['user'] },
      );
      let users = [
        ...new Map(assignments.map((a) => [a.user.id, a.user])).values(),
      ];
      if (options.search) {
        const needle = options.search.toLowerCase();
        users = users.filter((u) =>
          u.displayName.toLowerCase().includes(needle),
        );
      }
      users.sort(
        (a, b) =>
          a.displayName.localeCompare(b.displayName) ||
          a.id.localeCompare(b.id),
      );
      return {
        items: users.slice(options.offset, options.offset + options.limit),
        total: users.length,
      };
    }

    const where = options.search
      ? {
          section: communityId,
          status: {
            $in: [
              SectionMembershipStatus.ACTIVE,
              SectionMembershipStatus.READ_ONLY,
            ],
          },
          user: { displayName: { $ilike: `%${options.search}%` } },
        }
      : {
          section: communityId,
          status: {
            $in: [
              SectionMembershipStatus.ACTIVE,
              SectionMembershipStatus.READ_ONLY,
            ],
          },
        };

    const [memberships, total] = await em.findAndCount(
      SectionMembership,
      where,
      {
        populate: ['user'],
        orderBy: { user: { displayName: 'asc', id: 'asc' } } as never,
        limit: options.limit,
        offset: options.offset,
      },
    );

    return { items: memberships.map((m) => m.user), total };
  }

  /**
   * Every Group-or-Section id where `userId` currently holds *any*
   * currently-active Role Assignment - for a Group, that alone is
   * sufficient; for a Section, the corresponding SectionMembership must
   * also be ACTIVE/READ_ONLY (ending a membership revokes every Role
   * Assignment tied to it - see revokeAllForEndedMembership - but a
   * READ_ONLY one does not, so a suspended member's communities still
   * count here). Used by AnnouncementsService.listForViewer as "every
   * community whose Announcements this user's cross-community feed may
   * include".
   */
  async getCommunityIdsWithAnyRole(userId: string): Promise<string[]> {
    const assignments = await this.em.find(
      RoleAssignment,
      { user: userId, revokedAt: null },
      { populate: ['group', 'section'] },
    );
    const groupIds = assignments
      .filter((a) => a.group !== null)
      .map((a) => a.group!.id);
    const sectionIds = [
      ...new Set(
        assignments.filter((a) => a.section !== null).map((a) => a.section!.id),
      ),
    ];
    if (sectionIds.length === 0) {
      return groupIds;
    }
    const activeMemberships = await this.em.find(
      SectionMembership,
      {
        user: userId,
        section: { $in: sectionIds },
        status: {
          $in: [
            SectionMembershipStatus.ACTIVE,
            SectionMembershipStatus.READ_ONLY,
          ],
        },
      },
      { fields: ['section'] },
    );
    const activeSectionIds = new Set(
      activeMemberships.map((m) => m.section.id),
    );
    return [
      ...new Set([
        ...groupIds,
        ...sectionIds.filter((id) => activeSectionIds.has(id)),
      ]),
    ];
  }

  /**
   * Lazily expires a time-bound suspension (see MembershipSuspension) -
   * this codebase has no scheduler/cron infrastructure, so instead of a
   * background job flipping `status` back to ACTIVE at `until`, the next
   * time this membership's authorization is resolved (i.e. on the very
   * next request that touches this Section, by anyone), an `until` in the
   * past is detected and both the membership and the suspension record are
   * reconciled back to ACTIVE/lifted right here. Deliberately not
   * audit-logged as an UNSUSPEND action - no actor performed it, it is a
   * passive consequence of time passing.
   *
   * A no-op whenever the membership isn't READ_ONLY, has no active
   * suspension record, or that suspension is indefinite (`until === null`)
   * or not yet due.
   */
  private async reconcileExpiredSuspension(
    em: EntityManager,
    membership: SectionMembership,
  ): Promise<void> {
    if (membership.status !== SectionMembershipStatus.READ_ONLY) {
      return;
    }

    const suspension = await em.findOne(MembershipSuspension, {
      membership: membership.id,
      liftedAt: null,
    });
    if (!suspension?.until || suspension.until.getTime() > Date.now()) {
      return;
    }

    membership.status = SectionMembershipStatus.ACTIVE;
    suspension.liftedAt = new Date();
    await em.flush();
  }

  /**
   * Ensures `user` holds an active MEMBER Role Assignment for `section`,
   * creating one if it doesn't already exist. MEMBER is the base Role of
   * every Section membership - normally created atomically alongside the
   * SectionMembership itself (see SectionMembershipsService), so this
   * exists as a defensive idempotent backstop for grantRole(), not as the
   * primary creation path. Must run inside the caller's transaction.
   */
  async ensureMemberRole(
    em: EntityManager,
    section: Section,
    user: User,
    grantedBy: User | null,
  ): Promise<void> {
    const existing = await em.findOne(RoleAssignment, {
      user: user.id,
      section: section.id,
      role: GroupRole.MEMBER,
      revokedAt: null,
    });
    if (existing) {
      return;
    }
    await this.insertRoleAssignment(
      em,
      user,
      section,
      GroupRole.MEMBER,
      grantedBy,
    );
  }

  /**
   * Unconditionally creates one new Role Assignment row - the primitive
   * behind every Role grant (initial OWNER at Group/Section creation,
   * MEMBER on join, and additional Roles granted on top). Does not check
   * for an existing active (user, target, role) row - callers that need
   * that check (e.g. grantRole(), reachable directly from the API) must do
   * so themselves first. Must run inside the caller's transaction.
   */
  async insertRoleAssignment(
    em: EntityManager,
    user: User,
    community: Community,
    role: GroupRole,
    grantedBy: User | null,
  ): Promise<RoleAssignment> {
    const assignment = new RoleAssignment();
    assignment.user = user;
    if (community instanceof Section) {
      assignment.section = community;
    } else {
      assignment.group = community;
    }
    assignment.role = role;
    assignment.grantedAt = new Date();
    assignment.grantedBy = grantedBy;
    await em.persist(assignment).flush();
    return assignment;
  }

  /**
   * Revokes every currently-active Role Assignment `user` holds for
   * `section` - MEMBER and every additional Role - as a side effect of
   * their SectionMembership ending (leave/remove/ban). Must run in the
   * same transaction as the membership-ending update, so an authorization
   * check racing this operation never observes an ended membership with
   * still-active Role Assignments. Does not touch historical
   * (already-revoked) rows - they stay exactly as they were.
   */
  async revokeAllForEndedMembership(
    em: EntityManager,
    user: User,
    section: Section,
    revokedBy: User | null,
  ): Promise<void> {
    await em.nativeUpdate(
      RoleAssignment,
      { user: user.id, section: section.id, revokedAt: null },
      { revokedAt: new Date(), revokedBy: revokedBy?.id ?? null },
    );
  }

  /**
   * Grants a Role for `groupOrSectionId` directly to `input.userId` - the
   * mechanism behind assigning a Role on either a Group or a Section (see
   * RoleAssignmentsController). OWNER is deliberately unassignable here -
   * see assignable-group-role.schema.ts; it can only be granted through
   * SectionMembershipsService.transferOwnership.
   */
  async grantRole(
    groupOrSectionId: string,
    input: CreateRoleAssignmentInput,
    actor: User,
  ): Promise<RoleAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const community = await this.groupHierarchyService.findCommunityById(
        groupOrSectionId,
        em,
      );
      if (!community) {
        throw this.groupNotFound();
      }

      const targetUser = await em.findOne(User, { id: input.userId });
      if (!targetUser) {
        throw this.userNotFound();
      }

      if (community instanceof Section) {
        const membership = await em.findOne(SectionMembership, {
          section: community.id,
          user: targetUser.id,
          status: {
            $in: [
              SectionMembershipStatus.ACTIVE,
              SectionMembershipStatus.READ_ONLY,
            ],
          },
        });
        if (!membership) {
          throw new ConflictException({
            code: 'ROLE_MEMBERSHIP_NOT_ACTIVE',
            message: 'A role can only be assigned to an active section member',
          });
        }
      }

      const existing = await em.findOne(RoleAssignment, {
        user: targetUser.id,
        ...communityFilter(community),
        role: input.role,
        revokedAt: null,
      });
      if (existing) {
        throw new ConflictException({
          code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
          message: 'This user already holds this role for this target',
        });
      }

      if (community instanceof Section && input.role !== GroupRole.MEMBER) {
        await this.ensureMemberRole(em, community, targetUser, actor);
      }

      let assignment: RoleAssignment;
      try {
        assignment = await this.insertRoleAssignment(
          em,
          targetUser,
          community,
          input.role,
          actor,
        );
      } catch (error) {
        // Race backstop - see the equivalent comment in
        // SectionMembershipsService.addMember().
        if (isUniqueViolationOn(error, ROLE_ASSIGNMENTS_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
            message: 'This user already holds this role for this target',
          });
        }
        throw error;
      }

      this.auditLogService.record(em, {
        community,
        action: AuditAction.ADD_ROLE,
        actor,
        targetType: AuditTargetType.USER,
        targetId: targetUser.id,
        metadata: { groupOrSectionId, role: input.role },
      });
      await em.flush();

      return toRoleAssignmentResponseDto(assignment, this.r2StorageService);
    });
  }

  async listRoleAssignments(
    groupOrSectionId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    const assignments = await this.em.find(
      RoleAssignment,
      { ...communityIdFilter(groupOrSectionId), revokedAt: null },
      {
        populate: ['user', 'grantedBy', 'revokedBy'],
        orderBy: { grantedAt: 'asc' },
      },
    );
    return assignments.map((assignment) =>
      toRoleAssignmentResponseDto(assignment, this.r2StorageService),
    );
  }

  async getRoleAssignment(
    groupOrSectionId: string,
    roleAssignmentId: string,
  ): Promise<RoleAssignmentResponseDto> {
    const assignment = await this.loadByIdOrFail(
      this.em,
      groupOrSectionId,
      roleAssignmentId,
    );
    return toRoleAssignmentResponseDto(assignment, this.r2StorageService);
  }

  /**
   * Revokes a single Role Assignment (soft: sets revokedAt/revokedBy,
   * never deletes the row - see role-assignment.entity.ts). Two Roles are
   * protected against direct revocation here:
   *
   * - OWNER can only move via an atomic ownership transfer (see
   *   SectionMembershipsService.transferOwnership) - never revoked
   *   directly, since a target must never be left without one.
   * - MEMBER is the base Role of a Section membership: it can only be
   *   revoked as a side effect of the membership ending (leave/remove/ban -
   *   see revokeAllForEndedMembership), never through this endpoint
   *   directly, so a membership can never be left without its base Role
   *   while still ACTIVE/READ_ONLY.
   */
  async revokeRole(
    groupOrSectionId: string,
    roleAssignmentId: string,
    actor: User,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const assignment = await this.loadByIdOrFail(
        em,
        groupOrSectionId,
        roleAssignmentId,
      );

      if (assignment.role === GroupRole.OWNER) {
        throw new ConflictException({
          code: 'CANNOT_REMOVE_OWNER',
          message: 'The owner role cannot be revoked directly',
        });
      }

      if (assignment.role === GroupRole.MEMBER) {
        throw new ConflictException({
          code: 'CANNOT_REMOVE_MEMBER_ROLE',
          message:
            'MEMBER cannot be revoked directly - use leave or remove the member instead',
        });
      }

      const targetUserId = assignment.user.id;
      const role = assignment.role;
      assignment.revokedAt = new Date();
      assignment.revokedBy = actor;
      await em.flush();

      const community = assignment.group ?? assignment.section ?? undefined;
      this.auditLogService.record(em, {
        community: community!,
        action: AuditAction.REMOVE_ROLE,
        actor,
        targetType: AuditTargetType.USER,
        targetId: targetUserId,
        metadata: { groupOrSectionId, role },
      });
      await em.flush();
    });
  }

  /**
   * Atomic ownership transfer for a Group or a Section - one implementation,
   * branching by target kind, so the "never zero, never two active OWNERs"
   * invariant is enforced identically for both:
   *  - Group: the new owner must already hold an active ADMIN Role
   *    Assignment there (the Group-side equivalent of "already a member" -
   *    Group has no membership to check instead). Only the OWNER
   *    RoleAssignment row is locked (FOR UPDATE) - there is no membership
   *    row to lock.
   *  - Section: the new owner must have a `SectionMembership.status`of
   *    exactly ACTIVE (READ_ONLY is not enough - ownership must never move
   *    to someone who cannot currently act). Both the previous and new
   *    owner's SectionMembership rows are locked (FOR UPDATE), serializing
   *    against a concurrent leave()/removeMember()/banMember() naming
   *    either of them.
   *
   * In both branches: the previous owner's OWNER row is revoked
   * (revokedAt/revokedBy set, never deleted); the new owner's OWNER row is
   * inserted fresh (their MEMBER role, for a Section, is ensured alongside
   * it, defensively - they should already hold it, being ACTIVE). The
   * previous owner keeps every other Role they hold untouched.
   */
  async transferOwnership(
    groupOrSectionId: string,
    currentOwnerUserId: string,
    newOwnerUserId: string,
    actor: User,
  ): Promise<TransferOwnershipResponseDto> {
    if (newOwnerUserId === currentOwnerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_TRANSFER_TO_SELF',
        message: 'newOwnerUserId must be a different user',
      });
    }

    return this.em.transactional(async (em) => {
      const community = await this.groupHierarchyService.findCommunityById(
        groupOrSectionId,
        em,
      );
      if (!community) {
        throw this.groupNotFound();
      }

      const newOwnerUser = await em.findOne(User, { id: newOwnerUserId });
      if (!newOwnerUser) {
        throw this.userNotFound();
      }

      if (community instanceof Section) {
        await em.findOne(
          SectionMembership,
          { section: community.id, user: currentOwnerUserId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        const newOwnerMembership = await em.findOne(
          SectionMembership,
          { section: community.id, user: newOwnerUserId },
          { lockMode: LockMode.PESSIMISTIC_WRITE },
        );
        if (
          !newOwnerMembership ||
          newOwnerMembership.status !== SectionMembershipStatus.ACTIVE
        ) {
          throw new BadRequestException({
            code: 'TARGET_NOT_ACTIVE_MEMBER',
            message:
              'newOwnerUserId must have an ACTIVE membership in this section',
          });
        }
      } else {
        const newOwnerIsAdmin = await this.hasRole(
          em,
          newOwnerUserId,
          community.id,
          GroupRole.ADMIN,
        );
        if (!newOwnerIsAdmin) {
          throw new BadRequestException({
            code: 'TARGET_NOT_GROUP_ADMIN',
            message: 'newOwnerUserId must already be an ADMIN of this group',
          });
        }

        // OWNER -> formal membership invariant (see owner-formal-group.ts):
        // the new owner becomes a formal member of this Group in the same
        // transaction - unless that would break "one formal Group per
        // user" / "one owned Group per user", which is refused instead.
        const blocker = await getOwnershipTransferBlocker(
          em,
          newOwnerUserId,
          community.id,
        );
        if (blocker === 'OWNS_ANOTHER_GROUP') {
          throw new ConflictException({
            code: 'TARGET_ALREADY_OWNS_GROUP',
            message: 'newOwnerUserId already owns another group',
          });
        }
        if (blocker === 'OTHER_FORMAL_GROUP') {
          throw new ConflictException({
            code: 'TARGET_HAS_OTHER_FORMAL_GROUP',
            message:
              'newOwnerUserId is a formal member of another group - they must leave it first',
          });
        }
        const targetAffiliation = await em.findOne(FormalGroupAffiliation, {
          user: newOwnerUserId,
          endedOn: null,
        });
        if (!targetAffiliation) {
          const affiliation = new FormalGroupAffiliation();
          affiliation.user = newOwnerUser;
          affiliation.group = community;
          affiliation.startedOn = null;
          em.persist(affiliation);
        }
      }

      const previousOwnerAssignment = await em.findOne(
        RoleAssignment,
        {
          user: currentOwnerUserId,
          ...communityFilter(community),
          role: GroupRole.OWNER,
          revokedAt: null,
        },
        { lockMode: LockMode.PESSIMISTIC_WRITE, populate: ['user'] },
      );
      if (!previousOwnerAssignment) {
        throw this.groupNotFound();
      }

      previousOwnerAssignment.revokedAt = new Date();
      previousOwnerAssignment.revokedBy = actor;
      // Flushed before the new OWNER row is inserted below - MikroORM's
      // UnitOfWork applies inserts before updates within a single flush,
      // which would otherwise insert the new OWNER row while the previous
      // one is still active, transiently violating
      // ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX (exactly one active OWNER).
      await em.flush();

      if (community instanceof Section) {
        await this.ensureMemberRole(em, community, newOwnerUser, actor);
      }
      const newOwnerAssignment = await this.insertRoleAssignment(
        em,
        newOwnerUser,
        community,
        GroupRole.OWNER,
        actor,
      );

      this.auditLogService.record(em, {
        community,
        action: AuditAction.TRANSFER_OWNERSHIP,
        actor,
        targetType: AuditTargetType.USER,
        targetId: newOwnerUserId,
        metadata: { groupOrSectionId, previousOwnerUserId: currentOwnerUserId },
      });
      await em.flush();

      return {
        previousOwner: toRoleAssignmentResponseDto(
          previousOwnerAssignment,
          this.r2StorageService,
        ),
        newOwner: toRoleAssignmentResponseDto(
          newOwnerAssignment,
          this.r2StorageService,
        ),
      };
    });
  }

  /**
   * GET /groups/:groupId/role-assignments/admin-candidates - the people the
   * Group "Dodaj administratora" screen may pick from: only the Group's
   * formal members (an active FormalGroupAffiliation with this exact Group
   * - never followers, never people tied to it only through a Section).
   * Members already holding OWNER/ADMIN there are left out of the default
   * (no `search`) list, but a search that matches them returns them with
   * `currentRole` set, so the app shows them as "already added" instead of
   * leaving the searcher wondering why they are missing. Formal affiliation
   * is otherwise privacy-gated (showFormalGroup), so this list is only
   * reachable behind ROLE_ASSIGNMENT_MANAGE, never a public search filter.
   *
   * `search` matches firstName/lastName/apelido (substring) or the exact
   * user code - digits ("123456"/"123-456") or the app's displayed form
   * ("U123-456"), see normalizeUserCodeInput. `userId` (the QR flow) narrows
   * to that one person - also returned when they already hold a role, so
   * the app can say so. Ordered by last then first name.
   */
  async listGroupAdminCandidates(
    groupId: string,
    filter: { search?: string; userId?: string },
    page: { limit: number; offset: number },
  ): Promise<{ items: GroupAdminCandidateDto[]; total: number }> {
    const affiliations = await this.em.find(FormalGroupAffiliation, {
      group: groupId,
      endedOn: null,
    });
    const roleHolders = await this.em.find(RoleAssignment, {
      group: groupId,
      role: { $in: [GroupRole.OWNER, GroupRole.ADMIN] },
      revokedAt: null,
    });
    // OWNER wins over ADMIN for a user holding both.
    const roleByUserId = new Map<string, GroupRole.OWNER | GroupRole.ADMIN>();
    for (const assignment of roleHolders) {
      if (roleByUserId.get(assignment.user.id) !== GroupRole.OWNER) {
        roleByUserId.set(
          assignment.user.id,
          assignment.role as GroupRole.OWNER | GroupRole.ADMIN,
        );
      }
    }
    const trimmed = filter.search?.trim() ?? '';
    // Role holders only appear when explicitly looked for (a search or a
    // scanned userId), never in the default list.
    const isLookup = trimmed.length > 0 || filter.userId !== undefined;
    const candidateIds = affiliations
      .map((affiliation) => affiliation.user.id)
      .filter((userId) => !filter.userId || userId === filter.userId)
      .filter((userId) => isLookup || !roleByUserId.has(userId));
    if (candidateIds.length === 0) {
      return { items: [], total: 0 };
    }

    const where: FilterQuery<User> = { id: { $in: candidateIds } };
    if (trimmed.length > 0) {
      const numericCode = normalizeUserCodeInput(trimmed);
      const pattern = `%${trimmed}%`;
      where.$or = [
        { firstName: { $ilike: pattern } },
        { lastName: { $ilike: pattern } },
        { apelido: { $ilike: pattern } },
        ...(numericCode ? [{ numericCode }] : []),
      ];
    }

    const [users, total] = await this.em.findAndCount(User, where, {
      limit: page.limit,
      offset: page.offset,
      orderBy: { lastName: 'asc', firstName: 'asc', id: 'asc' },
    });
    return {
      total,
      items: users.map((user) => ({
        id: user.id,
        displayName: resolveDisplayName(user),
        apelido: user.apelido,
        image: {
          type: user.avatarType,
          url: resolveUserAvatarUrl(user, this.r2StorageService),
          presetAvatarId: user.presetAvatarId,
        },
        numericCode: user.numericCode,
        currentRole: roleByUserId.get(user.id) ?? null,
      })),
    };
  }

  /**
   * GET /groups/:id/ownership-transfer-candidates - every active ADMIN of
   * the Group (the only valid transfer targets, see transferOwnership),
   * each with whether ownership may go to them and, if not, why - so the
   * app can grey out a blocked admin and explain it instead of failing on
   * submit. Uses the exact same getOwnershipTransferBlocker the transfer
   * itself enforces. Excludes the current OWNER.
   */
  async listGroupOwnershipTransferCandidates(
    groupId: string,
    currentOwnerUserId: string,
  ): Promise<OwnershipTransferCandidateDto[]> {
    const admins = await this.em.find(
      RoleAssignment,
      { group: groupId, role: GroupRole.ADMIN, revokedAt: null },
      { populate: ['user'] },
    );
    const candidates: OwnershipTransferCandidateDto[] = [];
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager corrupt the underlying pg connection.
    for (const admin of admins) {
      if (admin.user.id === currentOwnerUserId) continue;
      const blocker = await getOwnershipTransferBlocker(
        this.em,
        admin.user.id,
        groupId,
      );
      candidates.push({
        user: { id: admin.user.id, displayName: admin.user.displayName },
        eligible: blocker === null,
        blocker,
      });
    }
    return candidates;
  }

  /**
   * Whether `userId` currently holds an active `role` for
   * `groupOrSectionId` - used for existence checks that don't care about
   * any *other* Role the user might additionally hold there (e.g. "is this
   * user the target's OWNER").
   */
  async hasRole(
    em: EntityManager,
    userId: string,
    groupOrSectionId: string,
    role: GroupRole,
  ): Promise<boolean> {
    const assignment = await em.findOne(RoleAssignment, {
      user: userId,
      ...communityIdFilter(groupOrSectionId),
      role,
      revokedAt: null,
    });
    return assignment !== null;
  }

  /**
   * Finds the specific active Role Assignment row for (user,
   * groupOrSectionId, role), if any - used by transferOwnership to locate
   * the exact OWNER row to revoke, and by OWNER-lifecycle guards to check
   * whether a target user is the current OWNER.
   */
  async findRoleAssignment(
    em: EntityManager,
    userId: string,
    groupOrSectionId: string,
    role: GroupRole,
  ): Promise<RoleAssignment | null> {
    return em.findOne(RoleAssignment, {
      user: userId,
      ...communityIdFilter(groupOrSectionId),
      role,
      revokedAt: null,
    });
  }

  /**
   * Every active Role a user holds for a specific Group-or-Section - used
   * to surface `rootRoles`/`roles` on membership response DTOs. May be
   * empty or contain several Roles at once.
   */
  async getRoleAssignmentsForUser(
    em: EntityManager,
    userId: string,
    groupOrSectionId: string,
  ): Promise<RoleAssignment[]> {
    return em.find(RoleAssignment, {
      user: userId,
      ...communityIdFilter(groupOrSectionId),
      revokedAt: null,
    });
  }

  /**
   * Batch version of getRoleAssignmentsForUser for a single target, across
   * many users - avoids N+1 queries when building a member list response.
   */
  async getRoleAssignmentsForTarget(
    userIds: string[],
    groupOrSectionId: string,
  ): Promise<Map<string, GroupRole[]>> {
    if (userIds.length === 0) {
      return new Map();
    }
    const assignments = await this.em.find(RoleAssignment, {
      user: { $in: userIds },
      ...communityIdFilter(groupOrSectionId),
      revokedAt: null,
    });
    const result = new Map<string, GroupRole[]>();
    for (const assignment of assignments) {
      const userId = assignment.user.id;
      const roles = result.get(userId) ?? [];
      roles.push(assignment.role);
      result.set(userId, roles);
    }
    return result;
  }

  /**
   * Cross-target batch lookup: for each (userId, groupOrSectionId) pair,
   * find every active Role that user holds for that specific target - used
   * by GroupsService.listMine, where every row is a *different* Group.
   */
  async getRoleAssignmentsForUsers(
    pairs: { userId: string; groupOrSectionId: string }[],
  ): Promise<Map<string, GroupRole[]>> {
    if (pairs.length === 0) {
      return new Map();
    }
    const userIds = [...new Set(pairs.map((pair) => pair.userId))];
    const assignments = await this.em.find(RoleAssignment, {
      user: { $in: userIds },
      revokedAt: null,
    });
    const byUserAndTarget = new Map<string, GroupRole[]>();
    for (const assignment of assignments) {
      const targetId = (assignment.group ?? assignment.section)!.id;
      const key = `${assignment.user.id}:${targetId}`;
      const roles = byUserAndTarget.get(key) ?? [];
      roles.push(assignment.role);
      byUserAndTarget.set(key, roles);
    }
    const result = new Map<string, GroupRole[]>();
    for (const pair of pairs) {
      const roles = byUserAndTarget.get(
        `${pair.userId}:${pair.groupOrSectionId}`,
      );
      if (roles) {
        result.set(pair.userId, roles);
      }
    }
    return result;
  }

  /**
   * Every (target id, Role[]) pair any of the given users holds a Role
   * Assignment for - Group or Section, at any depth - batched across all
   * users in a single query. Unlike getRoleAssignmentsForUsers(), this
   * does not require the caller to already know which targets to ask
   * about; it discovers every target each user actually participates in.
   * Used by Community Home to build the "My Communities" list.
   */
  async getGroupParticipationForUsers(
    userIds: string[],
  ): Promise<{ userId: string; groupId: string; roles: GroupRole[] }[]> {
    if (userIds.length === 0) {
      return [];
    }
    const assignments = await this.em.find(RoleAssignment, {
      user: { $in: userIds },
      revokedAt: null,
    });
    const byKey = new Map<
      string,
      { userId: string; groupId: string; roles: GroupRole[] }
    >();
    for (const assignment of assignments) {
      const userId = assignment.user.id;
      const groupId = (assignment.group ?? assignment.section)!.id;
      const key = `${userId}:${groupId}`;
      const entry = byKey.get(key) ?? { userId, groupId, roles: [] };
      entry.roles.push(assignment.role);
      byKey.set(key, entry);
    }
    return [...byKey.values()];
  }

  private async loadByIdOrFail(
    em: EntityManager,
    groupOrSectionId: string,
    roleAssignmentId: string,
  ): Promise<RoleAssignment> {
    const assignment = await em.findOne(
      RoleAssignment,
      {
        id: roleAssignmentId,
        ...communityIdFilter(groupOrSectionId),
        revokedAt: null,
      },
      { populate: ['user', 'grantedBy', 'revokedBy'] },
    );
    if (!assignment) {
      throw new NotFoundException({
        code: 'ROLE_ASSIGNMENT_NOT_FOUND',
        message: 'Role assignment not found',
      });
    }
    return assignment;
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  private userNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'USER_NOT_FOUND',
      message: 'User not found',
    });
  }
}
