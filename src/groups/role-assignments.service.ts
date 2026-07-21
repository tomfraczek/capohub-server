import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { ChangeRoleAssignmentInput } from './dto/change-role-assignment.schema';
import { CreateRoleAssignmentInput } from './dto/create-role-assignment.schema';
import { RoleAssignmentResponseDto } from './dto/role-assignment-response.dto';
import { Group } from './entities/group.entity';
import { GroupMembership } from './entities/group-membership.entity';
import {
  ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  RoleAssignment,
} from './entities/role-assignment.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { toRoleAssignmentResponseDto } from './mappers/group.mapper';

export interface ResolvedGroupAuthorization {
  group: Group;
  membership: GroupMembership;
  // Every active Role Assignment the Membership holds for this exact
  // Group - never a single Role, since a Membership may hold several at
  // once (e.g. MEMBER + INSTRUCTOR + ADMIN together - see ADR-028).
  roleAssignments: RoleAssignment[];
}

// The single place that creates, changes, and revokes Role Assignments,
// and resolves "what authority does this user have, directly, for this
// exact Group" (see ADR-028, ADR-013: Role Assignment is a separate
// concept from Membership, scoped per-Group, never inherited through the
// hierarchy). GroupPermissionsGuard is the primary caller of
// resolveAuthorization(); GroupsService and GroupMembershipsService call
// the mutation methods for the Root Group bootstrap/member-management
// flows they already own.
@Injectable()
export class RoleAssignmentsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  /**
   * Resolves the caller's authorization for `groupId` directly - never a
   * Root Group fallback, never inherited from a parent or sibling Group
   * (see ADR-013). Returns null if the user has no usable Membership in
   * the Group's Root Group (INVITED/ARCHIVED memberships are excluded -
   * only ACTIVE/READ_ONLY carry any authority), or holds no Role
   * Assignment at all for this exact Group. When it does hold Role
   * Assignments, `roleAssignments` may contain more than one row - the
   * caller is responsible for unioning their permissions (see
   * GroupPermissionService.hasAllPermissionsForRoles), never picking just
   * one.
   *
   * Accepts an optional `em` so callers running inside their own
   * `em.transactional(...)` callback (e.g. GroupsService.create checking
   * whether the caller may attach a Child Group here) can pass that forked
   * EntityManager through, rather than this reaching for `this.em` from
   * inside someone else's transaction.
   */
  async resolveAuthorization(
    groupId: string,
    userId: string,
    em: EntityManager = this.em,
  ): Promise<ResolvedGroupAuthorization | null> {
    const group = await em.findOne(Group, { id: groupId });
    if (!group) {
      return null;
    }

    const rootGroupId = group.parentGroup
      ? (await this.groupHierarchyService.getRootGroup(group.id, em)).id
      : group.id;

    const membership = await em.findOne(GroupMembership, {
      rootGroup: rootGroupId,
      user: userId,
      status: {
        $in: [GroupMembershipStatus.ACTIVE, GroupMembershipStatus.READ_ONLY],
      },
    });
    if (!membership) {
      return null;
    }

    const roleAssignments = await em.find(RoleAssignment, {
      membership: membership.id,
      group: groupId,
    });
    if (roleAssignments.length === 0) {
      return null;
    }

    return { group, membership, roleAssignments };
  }

  /**
   * Ensures `membership` holds a MEMBER Role Assignment for `group`,
   * creating one if it doesn't already exist - the automatic consequence
   * of being added to, or joining, a Group (Root or Child): MEMBER answers
   * "does this user belong to this specific Group", separate from
   * Membership itself (which only answers "does this user belong to the
   * organization"). Idempotent - safe to call even if the Role Assignment
   * already exists. Must run inside the caller's transaction.
   */
  async ensureMemberRole(
    em: EntityManager,
    membership: GroupMembership,
    group: Group,
  ): Promise<void> {
    const existing = await em.findOne(RoleAssignment, {
      membership: membership.id,
      group: group.id,
      role: GroupRole.MEMBER,
    });
    if (existing) {
      return;
    }
    await this.grantRole(em, membership, group, GroupRole.MEMBER);
  }

  /**
   * Unconditionally creates one new Role Assignment row - the primitive
   * behind every Role grant (initial OWNER at Group creation, automatic
   * MEMBER on join, and additional Roles granted on top of either). Does
   * not check for an existing (membership, group, role) row - callers that
   * need that check (e.g. assignRole(), which is reachable directly from
   * the API) must do so themselves first. Must run inside the caller's
   * transaction.
   */
  async grantRole(
    em: EntityManager,
    membership: GroupMembership,
    group: Group,
    role: GroupRole,
  ): Promise<RoleAssignment> {
    const assignment = new RoleAssignment();
    assignment.membership = membership;
    assignment.group = group;
    assignment.role = role;
    assignment.grantedAt = new Date();
    await em.persist(assignment).flush();
    return assignment;
  }

  /**
   * Grants a Role for `groupId` to an existing Membership - the mechanism
   * behind assigning a Role in any Group, Root or Child (see
   * RoleAssignmentsController). OWNER is deliberately unassignable here -
   * see assignable-group-role.schema.ts; it can only be granted through
   * transferOwnership. If this is the Membership's first Role Assignment
   * for this Group, MEMBER is granted alongside the requested Role (unless
   * the requested Role is itself MEMBER) - see ensureMemberRole().
   */
  async assignRole(
    groupId: string,
    input: CreateRoleAssignmentInput,
  ): Promise<RoleAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const group = await em.findOne(Group, { id: groupId });
      if (!group) {
        throw this.groupNotFound();
      }

      const membership = await em.findOne(
        GroupMembership,
        { id: input.membershipId },
        { populate: ['user', 'rootGroup'] },
      );
      if (!membership) {
        throw this.membershipNotFound();
      }

      const rootGroupId = group.parentGroup
        ? (await this.groupHierarchyService.getRootGroup(group.id, em)).id
        : group.id;
      if (membership.rootGroup.id !== rootGroupId) {
        throw new ConflictException({
          code: 'ROLE_ROOT_GROUP_MISMATCH',
          message:
            "This membership does not belong to the target group's Root Group",
        });
      }

      if (membership.status !== GroupMembershipStatus.ACTIVE) {
        throw new ConflictException({
          code: 'ROLE_MEMBERSHIP_NOT_ACTIVE',
          message: 'A Role can only be assigned to an active membership',
        });
      }

      const existing = await em.findOne(RoleAssignment, {
        membership: input.membershipId,
        group: groupId,
        role: input.role,
      });
      if (existing) {
        throw new ConflictException({
          code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
          message: 'This membership already holds this role in this group',
        });
      }

      if (input.role !== GroupRole.MEMBER) {
        await this.ensureMemberRole(em, membership, group);
      }

      let assignment: RoleAssignment;
      try {
        assignment = await this.grantRole(em, membership, group, input.role);
      } catch (error) {
        // Race backstop - see the equivalent comment in
        // GroupMembershipsService.addMember().
        if (isUniqueViolationOn(error, ROLE_ASSIGNMENTS_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
            message: 'This membership already holds this role in this group',
          });
        }
        throw error;
      }

      return toRoleAssignmentResponseDto(assignment);
    });
  }

  async listRoleAssignments(
    groupId: string,
  ): Promise<RoleAssignmentResponseDto[]> {
    const assignments = await this.em.find(
      RoleAssignment,
      { group: groupId },
      {
        populate: ['membership', 'membership.user'],
        orderBy: { grantedAt: 'asc' },
      },
    );
    return assignments.map(toRoleAssignmentResponseDto);
  }

  async getRoleAssignment(
    groupId: string,
    roleAssignmentId: string,
  ): Promise<RoleAssignmentResponseDto> {
    const assignment = await this.loadByIdOrFail(
      this.em,
      groupId,
      roleAssignmentId,
    );
    return toRoleAssignmentResponseDto(assignment);
  }

  async changeRole(
    groupId: string,
    roleAssignmentId: string,
    input: ChangeRoleAssignmentInput,
  ): Promise<RoleAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const assignment = await this.loadByIdOrFail(
        em,
        groupId,
        roleAssignmentId,
      );

      // OWNER can only change through the ownership-transfer flow, which
      // simultaneously assigns a new OWNER - never leaving the Group
      // without exactly one (mirrors GroupMembershipsService.leave/
      // removeMember's OWNER checks).
      if (assignment.role === GroupRole.OWNER) {
        throw new ConflictException({
          code: 'CANNOT_CHANGE_OWNER_ROLE',
          message: 'The owner role cannot be changed directly',
        });
      }

      if (input.role !== assignment.role) {
        const existing = await em.findOne(RoleAssignment, {
          membership: assignment.membership.id,
          group: groupId,
          role: input.role,
        });
        if (existing) {
          throw new ConflictException({
            code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
            message: 'This membership already holds this role in this group',
          });
        }
      }

      assignment.role = input.role;
      try {
        await em.flush();
      } catch (error) {
        if (isUniqueViolationOn(error, ROLE_ASSIGNMENTS_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
            message: 'This membership already holds this role in this group',
          });
        }
        throw error;
      }
      return toRoleAssignmentResponseDto(assignment);
    });
  }

  async revokeRole(groupId: string, roleAssignmentId: string): Promise<void> {
    const assignment = await this.loadByIdOrFail(
      this.em,
      groupId,
      roleAssignmentId,
    );

    if (assignment.role === GroupRole.OWNER) {
      throw new ConflictException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'The owner role cannot be revoked directly',
      });
    }

    await this.em.remove(assignment).flush();
  }

  /**
   * Whether `membershipId` holds an active-in-principle Role Assignment
   * for `role` in `groupId` - used for existence checks that don't care
   * about any *other* Role the Membership might additionally hold there
   * (e.g. "is this membership the Group's OWNER", which no longer implies
   * OWNER is their only Role - see GroupMembershipsService.removeMember/
   * leave).
   */
  async hasRole(
    em: EntityManager,
    membershipId: string,
    groupId: string,
    role: GroupRole,
  ): Promise<boolean> {
    const assignment = await em.findOne(RoleAssignment, {
      membership: membershipId,
      group: groupId,
      role,
    });
    return assignment !== null;
  }

  /**
   * Finds the specific Role Assignment row for (membership, group, role),
   * if any - used by transferOwnership to locate the exact OWNER row to
   * remove.
   */
  async findRoleAssignment(
    em: EntityManager,
    membershipId: string,
    groupId: string,
    role: GroupRole,
  ): Promise<RoleAssignment | null> {
    return em.findOne(RoleAssignment, {
      membership: membershipId,
      group: groupId,
      role,
    });
  }

  /**
   * Every Role a Membership holds for a specific Group - used to surface
   * `rootRoles` on GroupMembershipResponseDto. May be empty (no Role
   * Assignment at all) or contain several Roles at once.
   */
  async getRoleAssignmentsForMembership(
    em: EntityManager,
    membershipId: string,
    groupId: string,
  ): Promise<RoleAssignment[]> {
    return em.find(RoleAssignment, {
      membership: membershipId,
      group: groupId,
    });
  }

  /**
   * Batch version of getRoleAssignmentsForMembership for a single Group,
   * across many Memberships - avoids N+1 queries when building a member
   * list response. Each Membership may map to several Roles.
   */
  async getRoleAssignmentsForGroup(
    membershipIds: string[],
    groupId: string,
  ): Promise<Map<string, GroupRole[]>> {
    if (membershipIds.length === 0) {
      return new Map();
    }
    const assignments = await this.em.find(RoleAssignment, {
      membership: { $in: membershipIds },
      group: groupId,
    });
    const result = new Map<string, GroupRole[]>();
    for (const assignment of assignments) {
      const membershipId = assignment.membership.id;
      const roles = result.get(membershipId) ?? [];
      roles.push(assignment.role);
      result.set(membershipId, roles);
    }
    return result;
  }

  /**
   * Cross-group batch lookup: for each (membershipId, groupId) pair, find
   * every Role that Membership holds for that specific Group - used by
   * GroupsService.listMine, where every row is a *different* Root Group.
   */
  async getRoleAssignmentsForMemberships(
    pairs: { membershipId: string; groupId: string }[],
  ): Promise<Map<string, GroupRole[]>> {
    if (pairs.length === 0) {
      return new Map();
    }
    const membershipIds = pairs.map((pair) => pair.membershipId);
    const assignments = await this.em.find(RoleAssignment, {
      membership: { $in: membershipIds },
    });
    const byMembershipAndGroup = new Map<string, GroupRole[]>();
    for (const assignment of assignments) {
      const key = `${assignment.membership.id}:${assignment.group.id}`;
      const roles = byMembershipAndGroup.get(key) ?? [];
      roles.push(assignment.role);
      byMembershipAndGroup.set(key, roles);
    }
    const result = new Map<string, GroupRole[]>();
    for (const pair of pairs) {
      const roles = byMembershipAndGroup.get(
        `${pair.membershipId}:${pair.groupId}`,
      );
      if (roles) {
        result.set(pair.membershipId, roles);
      }
    }
    return result;
  }

  private async loadByIdOrFail(
    em: EntityManager,
    groupId: string,
    roleAssignmentId: string,
  ): Promise<RoleAssignment> {
    const assignment = await em.findOne(
      RoleAssignment,
      { id: roleAssignmentId, group: groupId },
      { populate: ['membership', 'membership.user'] },
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

  private membershipNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEMBERSHIP_NOT_FOUND',
      message: 'Group membership not found',
    });
  }
}
