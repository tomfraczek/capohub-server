import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { CreateGroupInput } from './dto/create-group.schema';
import { GroupResponseDto } from './dto/group-response.dto';
import { GroupSummaryResponseDto } from './dto/group-summary-response.dto';
import { UpdateGroupInput } from './dto/update-group.schema';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import {
  toGroupResponseDto,
  toGroupSummaryResponseDto,
} from './mappers/group.mapper';
import { RoleAssignmentsService } from './role-assignments.service';

@Injectable()
export class GroupsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly auditLogService: AuditLogService,
  ) {}

  // The creator automatically becomes OWNER (spec: "Po utworzeniu grupy
  // użytkownik automatycznie staje się OWNER") - Group and its creator's
  // Role Assignments for it are created atomically, so there is no window
  // where a Group exists without an owner. A Group always gets exactly one
  // OWNER this way - enforced not just by this code path but by
  // ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX (a DB-level partial unique index
  // on (group) where role = OWNER - see ADR-028). Being added to a Group
  // also always grants MEMBER for it (see
  // RoleAssignmentsService.ensureMemberRole), so the creator ends up
  // holding both MEMBER and OWNER - not just OWNER alone.
  //
  // A Group is always root-level: a brand new Membership is created for
  // the caller in the new Group, plus MEMBER and OWNER Role Assignments
  // for that same Group, tied to that Membership. Creating a Section
  // (nested under an existing Group or Section) is a different operation -
  // see SectionsService.create.
  async create(user: User, input: CreateGroupInput): Promise<GroupResponseDto> {
    const group = await this.em.transactional(async (em) => {
      const group = new Group();
      group.publicCode = await generateUniquePublicCode(em);
      this.applyFields(group, input);
      group.parentGroup = null;

      const ownerMembership = new GroupMembership();
      ownerMembership.rootGroup = group;
      ownerMembership.user = user;
      ownerMembership.joinedAt = new Date();
      em.persist([group, ownerMembership]);

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

      this.auditLogService.record(em, {
        community: group,
        action: AuditAction.CREATE_COMMUNITY,
        actor: user,
        targetType: AuditTargetType.COMMUNITY,
        targetId: group.id,
      });
      await em.flush();

      return group;
    });

    return toGroupResponseDto(group);
  }

  async listMine(userId: string): Promise<GroupSummaryResponseDto[]> {
    // READ_ONLY is included alongside ACTIVE - a suspended Membership
    // (see GroupMembershipsService.suspendMember) remains visible here,
    // same "remains visible... loses operational permissions" doctrine
    // already applied to GET /community/home (organization-entities.md#membership).
    const memberships = await this.em.find(
      GroupMembership,
      {
        user: userId,
        status: {
          $in: [GroupMembershipStatus.ACTIVE, GroupMembershipStatus.READ_ONLY],
        },
      },
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
    actor: User,
  ): Promise<GroupResponseDto> {
    return this.em.transactional(async (em) => {
      const group = await this.loadGroupOrFail(groupId, em);
      this.applyFields(group, input);
      this.recordCommunityAudit(em, group, AuditAction.UPDATE_COMMUNITY, actor);
      await em.flush();
      return toGroupResponseDto(group);
    });
  }

  // Whether the current status is actually allowed to move to the target
  // one is already decided before this ever runs - GroupPermissionsGuard
  // checks it via each endpoint's @AllowGroupStatuses(...)
  // (groups.controller.ts), so there is nothing left to validate here beyond
  // applying the new status. Memberships and Role Assignments are never
  // touched by any of these transitions (Delete included - see ADR-029).
  async archive(groupId: string, actor: User): Promise<GroupResponseDto> {
    return this.transitionStatus(
      groupId,
      GroupStatus.ARCHIVED,
      actor,
      AuditAction.ARCHIVE,
    );
  }

  // "Restore" in product/audit terms - see AuditAction.RESTORE.
  async unarchive(groupId: string, actor: User): Promise<GroupResponseDto> {
    return this.transitionStatus(
      groupId,
      GroupStatus.ACTIVE,
      actor,
      AuditAction.RESTORE,
    );
  }

  async setReadOnly(groupId: string, actor: User): Promise<GroupResponseDto> {
    return this.transitionStatus(groupId, GroupStatus.READ_ONLY, actor);
  }

  async activate(groupId: string, actor: User): Promise<GroupResponseDto> {
    return this.transitionStatus(groupId, GroupStatus.ACTIVE, actor);
  }

  /**
   * Permanently deletes a Community (a Group itself). Distinct from
   * Archive: DELETED is an irreversible sink state (no Restore path exists
   * out of it - see GroupStatus and ADR-029), while Archive remains fully
   * reversible via Unarchive. Like every other transition here, this is a
   * status-only change - no physical row deletion, no cascade to
   * Memberships or Role Assignments, which remain as historical rows
   * exactly as they do after Archive (ADR-007).
   *
   * Blocked while any Child Group is not already ARCHIVED or DELETED -
   * deleting a Community must not silently orphan an otherwise-functioning
   * substructure under a now-permanently-gone parent. This check is
   * *not* a Membership/Role guard (those never block Delete, mirroring
   * Archive) - it only concerns the Group hierarchy itself.
   */
  async delete(groupId: string, actor: User): Promise<GroupResponseDto> {
    return this.em.transactional(async (em) => {
      const group = await this.loadGroupOrFail(groupId, em);

      const children = await em.find(Group, { parentGroup: groupId });
      const activeChildren = children.filter(
        (child) =>
          child.status !== GroupStatus.ARCHIVED &&
          child.status !== GroupStatus.DELETED,
      );
      if (activeChildren.length > 0) {
        throw new ConflictException({
          code: 'GROUP_HAS_ACTIVE_CHILDREN',
          message:
            'Archive or delete every child group before deleting this one',
          childGroupIds: activeChildren.map((child) => child.id),
        });
      }

      group.status = GroupStatus.DELETED;
      this.recordCommunityAudit(em, group, AuditAction.DELETE, actor);
      await em.flush();
      return toGroupResponseDto(group);
    });
  }

  private async transitionStatus(
    groupId: string,
    target: GroupStatus,
    actor: User,
    auditAction?: AuditAction,
  ): Promise<GroupResponseDto> {
    return this.em.transactional(async (em) => {
      const group = await this.loadGroupOrFail(groupId, em);
      group.status = target;
      if (auditAction) {
        this.recordCommunityAudit(em, group, auditAction, actor);
      }
      await em.flush();
      return toGroupResponseDto(group);
    });
  }

  // GroupsController only ever acts on a root Group (enforced by
  // @RequireGroupKind(GroupKind.ROOT) at the route level - see
  // groups.controller.ts), so `group` here is always its own Root Group;
  // no resolution needed (contrast SectionsService, which still resolves
  // one, since a Section can be nested at any depth).
  private recordCommunityAudit(
    em: EntityManager,
    group: Group,
    action: AuditAction,
    actor: User,
  ): void {
    this.auditLogService.record(em, {
      community: group,
      action,
      actor,
      targetType: AuditTargetType.COMMUNITY,
      targetId: group.id,
    });
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
    group.country = input.country;
    group.city = input.city;
  }

  private async loadGroupOrFail(
    groupId: string,
    em: EntityManager = this.em,
  ): Promise<Group> {
    const group = await em.findOne(Group, { id: groupId });
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
