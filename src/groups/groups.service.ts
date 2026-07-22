import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { User } from '../users/entities/user.entity';
import { CreateGroupInput } from './dto/create-group.schema';
import { GroupResponseDto } from './dto/group-response.dto';
import { GroupSummaryResponseDto } from './dto/group-summary-response.dto';
import { UpdateGroupInput } from './dto/update-group.schema';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import {
  toGroupResponseDto,
  toGroupSummaryResponseDto,
} from './mappers/group.mapper';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsService } from './role-assignments.service';

@Injectable()
export class GroupsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  // The creator automatically becomes OWNER (spec: "Po utworzeniu grupy
  // użytkownik automatycznie staje się OWNER") - Group and its creator's
  // Role Assignments for it are created atomically, so there is no window
  // where a Group exists without an owner. Every Group (Root or Child)
  // always gets exactly one OWNER this way - enforced not just by this
  // code path but by ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX (a DB-level
  // partial unique index on (group) where role = OWNER - see ADR-028).
  // Being added to a Group also always grants MEMBER for it (see
  // RoleAssignmentsService.ensureMemberRole), so the creator ends up
  // holding both MEMBER and OWNER for their new Group - not just OWNER
  // alone (a Membership may hold several Roles for the same Group at
  // once).
  //
  // - Root Group (parentGroupId omitted): a brand new Membership is
  //   created for the caller in the new Group, plus MEMBER and OWNER Role
  //   Assignments for that same Group, tied to that Membership.
  // - Child Group (parentGroupId present): the caller must already hold an
  //   active Membership in the parent's Root Group, with GROUP_EDIT there
  //   directly (see loadUsableParentForCreation) - no second Membership is
  //   created; the new MEMBER and OWNER Role Assignments for the Child
  //   Group are tied to that *existing* Membership (see
  //   organization-entities.md#roleassignment: a Membership may hold Role
  //   Assignments in multiple different Groups).
  async create(user: User, input: CreateGroupInput): Promise<GroupResponseDto> {
    const group = await this.em.transactional(async (em) => {
      const group = new Group();
      group.publicCode = await generateUniquePublicCode(em);
      this.applyFields(group, input);

      let ownerMembership: GroupMembership;

      if (input.parentGroupId) {
        const parent = await this.loadUsableParentForCreation(
          em,
          input.parentGroupId,
          user.id,
        );
        group.parentGroup = parent.group;
        ownerMembership = parent.membership;
        em.persist(group);
      } else {
        group.parentGroup = null;

        ownerMembership = new GroupMembership();
        ownerMembership.rootGroup = group;
        ownerMembership.user = user;
        ownerMembership.joinedAt = new Date();
        em.persist([group, ownerMembership]);
      }

      await this.roleAssignmentsService.ensureMemberRole(
        em,
        ownerMembership,
        group,
      );
      await this.roleAssignmentsService.insertRoleAssignment(
        em,
        ownerMembership,
        group,
        GroupRole.OWNER,
      );

      return group;
    });

    return toGroupResponseDto(group);
  }

  async listChildren(groupId: string): Promise<GroupResponseDto[]> {
    const children = await this.em.find(Group, { parentGroup: groupId });
    return children.map(toGroupResponseDto);
  }

  // Creating a Child Group requires an active Membership in the parent's
  // Root Group *and* a Role Assignment for the parent Group itself
  // granting GROUP_EDIT - without this, any authenticated user could
  // attach a group under someone else's organization. Mirrors
  // GroupPermissionsGuard's non-enumeration rule: a caller with no usable
  // authorization for the parent gets the same "not found" response as a
  // truly missing parent, never a 403 that would confirm the parent
  // exists.
  private async loadUsableParentForCreation(
    em: EntityManager,
    parentGroupId: string,
    userId: string,
  ): Promise<{ group: Group; membership: GroupMembership }> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        parentGroupId,
        userId,
        em,
      );
    if (!authorization) {
      throw new NotFoundException({
        code: 'GROUP_PARENT_NOT_FOUND',
        message: 'The parent group does not exist',
      });
    }
    const { group: parent, membership, roleAssignments } = authorization;
    const roles = roleAssignments.map((roleAssignment) => roleAssignment.role);

    if (
      !this.groupPermissionService.hasAllPermissionsForRoles(
        roles,
        [GroupPermission.GROUP_EDIT],
        membership.status,
      )
    ) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_GROUP_PERMISSIONS',
        message: 'Insufficient permissions in the parent group',
      });
    }

    if (parent.status === GroupStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'GROUP_ARCHIVED',
        message: 'This group is archived and is read-only until it is restored',
      });
    }

    return { group: parent, membership };
  }

  async listMine(userId: string): Promise<GroupSummaryResponseDto[]> {
    const memberships = await this.em.find(
      GroupMembership,
      { user: userId, status: GroupMembershipStatus.ACTIVE },
      { populate: ['rootGroup'], orderBy: { joinedAt: 'desc' } },
    );

    const rootRoles =
      await this.roleAssignmentsService.getRoleAssignmentsForMemberships(
        memberships.map((membership) => ({
          membershipId: membership.id,
          groupId: membership.rootGroup.id,
        })),
      );

    return memberships.map((membership) =>
      toGroupSummaryResponseDto(
        membership.rootGroup,
        rootRoles.get(membership.id) ?? [],
      ),
    );
  }

  async getById(groupId: string): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    return toGroupResponseDto(group);
  }

  async update(
    groupId: string,
    input: UpdateGroupInput,
  ): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    this.applyFields(group, input);
    await this.em.flush();
    return toGroupResponseDto(group);
  }

  // Whether the current status is actually allowed to move to the target
  // one is already decided before this ever runs - GroupPermissionsGuard
  // checks it via each endpoint's @AllowGroupStatuses(...)
  // (groups.controller.ts), so there is nothing left to validate here beyond
  // applying the new status. Memberships and Role Assignments are never
  // touched by any of these four transitions.
  async archive(groupId: string): Promise<GroupResponseDto> {
    return this.transitionStatus(groupId, GroupStatus.ARCHIVED);
  }

  async unarchive(groupId: string): Promise<GroupResponseDto> {
    return this.transitionStatus(groupId, GroupStatus.ACTIVE);
  }

  async setReadOnly(groupId: string): Promise<GroupResponseDto> {
    return this.transitionStatus(groupId, GroupStatus.READ_ONLY);
  }

  async activate(groupId: string): Promise<GroupResponseDto> {
    return this.transitionStatus(groupId, GroupStatus.ACTIVE);
  }

  private async transitionStatus(
    groupId: string,
    target: GroupStatus,
  ): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    group.status = target;
    await this.em.flush();
    return toGroupResponseDto(group);
  }

  private applyFields(group: Group, input: UpdateGroupInput): void {
    group.name = input.name;
    group.description = input.description;
    group.logoUrl = input.logoUrl;
    group.coverImageUrl = input.coverImageUrl;
    group.contactEmail = input.contactEmail;
    group.contactPhone = input.contactPhone;
    group.websiteUrl = input.websiteUrl;
    group.facebookUrl = input.facebookUrl;
    group.instagramUrl = input.instagramUrl;
    group.youtubeUrl = input.youtubeUrl;
    group.isPublic = input.isPublic;
    group.isHidden = input.isHidden;
    group.memberInvitesAllowed = input.memberInvitesAllowed;
    group.timezone = input.timezone;
    group.currencyCode = input.currencyCode;
  }

  private async loadGroupOrFail(groupId: string): Promise<Group> {
    const group = await this.em.findOne(Group, { id: groupId });
    if (!group) {
      throw this.notFound();
    }
    return group;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
