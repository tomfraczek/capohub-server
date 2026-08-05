import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager, LockMode } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { CreateHierarchyInvitationInput } from './dto/create-hierarchy-invitation.schema';
import { GroupResponseDto } from './dto/group-response.dto';
import { HierarchyInvitationResponseDto } from './dto/hierarchy-invitation-response.dto';
import { HierarchyEntityRefDto } from './dto/hierarchy-response.dto';
import { SectionResponseDto } from './dto/section-response.dto';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { Group } from './entities/group.entity';
import {
  HIERARCHY_INVITATION_PENDING_UNIQUE_IDX,
  HierarchyInvitation,
} from './entities/hierarchy-invitation.entity';
import { Section } from './entities/section.entity';
import { HierarchyInvitationStatus } from './enums/hierarchy-invitation-status.enum';
import { Community, GroupHierarchyService } from './group-hierarchy.service';
import { GroupsService } from './groups.service';
import {
  GroupPermissionService,
  PermissionTargetKind,
} from './permissions/group-permission.service';
import { GroupPermission } from './permissions/group-permission.enum';
import {
  ResolvedGroupAuthorization,
  RoleAssignmentsService,
} from './role-assignments.service';
import { SectionsService } from './sections.service';

/**
 * Authorization + audit + DTO orchestration for the Group/Section hierarchy
 * (attach/detach/move a Group or Section under a parent Group, and the
 * HierarchyInvitation flow for when the actor manages the parent but not
 * the target). GroupHierarchyService remains the single owner of the
 * structural rules themselves (self-parent, cycle-freedom, parent
 * existence/status) - every mutation here delegates to it rather than
 * re-implementing any of that.
 *
 * Every permission check is resolved directly against the exact entity in
 * question via RoleAssignmentsService.resolveAuthorization - never
 * inherited from a parent, a child, or a sibling (see the class comment on
 * GroupHierarchyService and GroupPermission.HIERARCHY_MANAGE/
 * HIERARCHY_INVITE's own comments for the trust-tier rationale).
 */
@Injectable()
export class HierarchyManagementService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly auditLogService: AuditLogService,
    private readonly groupsService: GroupsService,
    private readonly sectionsService: SectionsService,
  ) {}

  // ─── Reads: parent / children / breadcrumbs ──────────────────────────────

  async getParent(id: string): Promise<HierarchyEntityRefDto | null> {
    const community = await this.groupHierarchyService.findCommunityById(id);
    if (!community) {
      throw this.communityNotFound();
    }
    return community.parentGroup ? this.toRef(community.parentGroup) : null;
  }

  /** Direct child Groups and direct Sections combined, name-sorted. */
  async listChildren(groupId: string): Promise<HierarchyEntityRefDto[]> {
    const [childGroups, childSections] = [
      await this.groupHierarchyService.listChildGroups(groupId),
      await this.groupHierarchyService.listDirectSections(groupId),
    ];
    const refs = [
      ...childGroups.map((group) => this.toRef(group)),
      ...childSections.map((section) => this.toRef(section)),
    ];
    refs.sort(
      (a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
    );
    return refs;
  }

  /**
   * Ordered chain from the top-level ancestor Group down to `id` itself
   * (inclusive) - deterministic (root-first) and cycle-guarded on read, not
   * just on write, since corrupt/legacy data could in principle only be
   * caught here (see GroupHierarchyService.walkToRoot for the same
   * defensive pattern).
   */
  async getBreadcrumbs(id: string): Promise<HierarchyEntityRefDto[]> {
    const community = await this.groupHierarchyService.findCommunityById(id);
    if (!community) {
      throw this.communityNotFound();
    }

    const chain: HierarchyEntityRefDto[] = [this.toRef(community)];
    const visited = new Set<string>([community.id]);
    let currentParentId = community.parentGroup?.id ?? null;

    while (currentParentId) {
      if (visited.has(currentParentId)) {
        throw this.cycleDetected();
      }
      const group = await this.em.findOne(Group, { id: currentParentId });
      if (!group) {
        break;
      }
      visited.add(group.id);
      chain.unshift(this.toRef(group));
      currentParentId = group.parentGroup?.id ?? null;
    }

    return chain;
  }

  // ─── Direct attach / move / detach ───────────────────────────────────────

  /**
   * Attaches-or-moves the Group `groupId` under `parentGroupId`. The same
   * primitive covers both "attach" (no previous parent) and "move" (had a
   * different parent) - GroupHierarchyService.attachChildGroup
   * unconditionally overwrites `parentGroup` regardless of its previous
   * value. Requires HIERARCHY_MANAGE on *both* `groupId` (already checked
   * by GroupPermissionsGuard at the route level - re-verified here inside
   * the transaction) and `parentGroupId` (only ever checked here, since it
   * arrives in the body, not the route).
   */
  async setGroupParent(
    groupId: string,
    parentGroupId: string,
    actor: User,
  ): Promise<GroupResponseDto> {
    const group = await this.em.transactional(async (em) => {
      await this.assertHierarchyManage(em, actor, groupId);
      await this.assertHierarchyManage(em, actor, parentGroupId);

      const child = await em.findOne(Group, { id: groupId });
      if (!child) {
        throw this.groupNotFound();
      }
      const previousParentId = child.parentGroup?.id ?? null;
      if (previousParentId === parentGroupId) {
        throw this.alreadyAttached();
      }

      const attached = await this.groupHierarchyService.attachChildGroup(
        groupId,
        parentGroupId,
        em,
      );

      this.auditLogService.record(em, {
        community: attached.parentGroup!,
        action: previousParentId
          ? AuditAction.MOVE_CHILD
          : AuditAction.ATTACH_CHILD,
        actor,
        targetType: AuditTargetType.COMMUNITY,
        targetId: attached.id,
        metadata: { previousParentId, newParentId: parentGroupId },
      });
      await em.flush();

      return attached;
    });

    return this.groupsService.getById(group.id);
  }

  /** Section counterpart of setGroupParent - see its own comment. */
  async setSectionParent(
    sectionId: string,
    parentGroupId: string,
    actor: User,
  ): Promise<SectionResponseDto> {
    const section = await this.em.transactional(async (em) => {
      await this.assertHierarchyManage(em, actor, sectionId);
      await this.assertHierarchyManage(em, actor, parentGroupId);

      const child = await em.findOne(Section, { id: sectionId });
      if (!child) {
        throw this.sectionNotFound();
      }
      const previousParentId = child.parentGroup?.id ?? null;
      if (previousParentId === parentGroupId) {
        throw this.alreadyAttached();
      }

      const attached = await this.groupHierarchyService.attachSection(
        sectionId,
        parentGroupId,
        em,
      );

      this.auditLogService.record(em, {
        community: attached.parentGroup!,
        action: previousParentId
          ? AuditAction.MOVE_CHILD
          : AuditAction.ATTACH_CHILD,
        actor,
        targetType: AuditTargetType.COMMUNITY,
        targetId: attached.id,
        metadata: { previousParentId, newParentId: parentGroupId },
      });
      await em.flush();

      return attached;
    });

    return this.sectionsService.getById(section.id);
  }

  /**
   * Detaches the Group `groupId` from its current parent, making it a root
   * Group again. Requires HIERARCHY_MANAGE on `groupId` only - the entity's
   * own OWNER controls its own parent link, symmetric with the requirement
   * that attach/move needs the child's own consent too. Never touches
   * membership or Role Assignments (see the class comment).
   */
  async detachGroup(groupId: string, actor: User): Promise<GroupResponseDto> {
    const group = await this.em.transactional(async (em) => {
      await this.assertHierarchyManage(em, actor, groupId);

      const child = await em.findOne(Group, { id: groupId });
      if (!child) {
        throw this.groupNotFound();
      }
      const previousParent = child.parentGroup;
      if (!previousParent) {
        throw this.notAttached();
      }

      const detached = await this.groupHierarchyService.detachChildGroup(
        groupId,
        em,
      );

      this.auditLogService.record(em, {
        community: previousParent,
        action: AuditAction.DETACH_CHILD,
        actor,
        targetType: AuditTargetType.COMMUNITY,
        targetId: detached.id,
        metadata: { previousParentId: previousParent.id, newParentId: null },
      });
      await em.flush();

      return detached;
    });

    return this.groupsService.getById(group.id);
  }

  /** Section counterpart of detachGroup - see its own comment. */
  async detachSection(
    sectionId: string,
    actor: User,
  ): Promise<SectionResponseDto> {
    const section = await this.em.transactional(async (em) => {
      await this.assertHierarchyManage(em, actor, sectionId);

      const child = await em.findOne(Section, { id: sectionId });
      if (!child) {
        throw this.sectionNotFound();
      }
      const previousParent = child.parentGroup;
      if (!previousParent) {
        throw this.notAttached();
      }

      const detached = await this.groupHierarchyService.detachSection(
        sectionId,
        em,
      );

      this.auditLogService.record(em, {
        community: previousParent,
        action: AuditAction.DETACH_CHILD,
        actor,
        targetType: AuditTargetType.COMMUNITY,
        targetId: detached.id,
        metadata: { previousParentId: previousParent.id, newParentId: null },
      });
      await em.flush();

      return detached;
    });

    return this.sectionsService.getById(section.id);
  }

  // ─── HierarchyInvitation: create / list / cancel (parent side) ──────────

  /**
   * Proposes attaching `input.targetId` under `parentGroupId` - for when the
   * actor manages the parent (holds HIERARCHY_INVITE there) but not the
   * target. Never mutates the hierarchy by itself; only acceptInvitation()
   * does that. Self-parent/cycle/parent-usability are validated immediately
   * (see GroupHierarchyService.assertCanAttachChildGroup/assertCanAttachSection)
   * so an invitation that could never be accepted is rejected up front -
   * acceptInvitation() re-validates the same rules again regardless.
   */
  async createInvitation(
    parentGroupId: string,
    input: CreateHierarchyInvitationInput,
    actor: User,
  ): Promise<HierarchyInvitationResponseDto> {
    return this.em.transactional(async (em) => {
      const parent = await this.assertHierarchyInvite(em, actor, parentGroupId);

      let targetGroup: Group | null = null;
      let targetSection: Section | null = null;

      if (input.targetType === 'GROUP') {
        targetGroup = await em.findOne(Group, { id: input.targetId });
        if (!targetGroup) {
          throw this.groupNotFound();
        }
        if (targetGroup.parentGroup?.id === parent.id) {
          throw this.alreadyAttached();
        }
        await this.groupHierarchyService.assertCanAttachChildGroup(
          targetGroup.id,
          parent.id,
          em,
        );
      } else {
        targetSection = await em.findOne(Section, { id: input.targetId });
        if (!targetSection) {
          throw this.sectionNotFound();
        }
        if (targetSection.parentGroup?.id === parent.id) {
          throw this.alreadyAttached();
        }
        await this.groupHierarchyService.assertCanAttachSection(parent.id, em);
      }

      const invitation = new HierarchyInvitation();
      invitation.parentGroup = parent;
      invitation.targetGroup = targetGroup;
      invitation.targetSection = targetSection;
      invitation.invitedBy = actor;

      try {
        em.persist(invitation);
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, HIERARCHY_INVITATION_PENDING_UNIQUE_IDX)
        ) {
          throw new ConflictException({
            code: 'HIERARCHY_INVITATION_ALREADY_PENDING',
            message: 'A pending invitation for this relation already exists',
          });
        }
        throw error;
      }

      this.auditLogService.record(em, {
        community: parent,
        action: AuditAction.INVITE_CHILD,
        actor,
        targetType: AuditTargetType.HIERARCHY_INVITATION,
        targetId: invitation.id,
        metadata: { targetType: input.targetType, targetId: input.targetId },
      });
      await em.flush();

      return this.toInvitationResponseDto(invitation);
    });
  }

  async listSentInvitations(
    parentGroupId: string,
  ): Promise<HierarchyInvitationResponseDto[]> {
    const invitations = await this.em.find(
      HierarchyInvitation,
      { parentGroup: parentGroupId },
      {
        populate: [
          'parentGroup',
          'targetGroup',
          'targetSection',
          'invitedBy',
          'respondedBy',
        ],
        orderBy: { createdAt: 'desc' },
      },
    );
    return invitations.map((invitation) =>
      this.toInvitationResponseDto(invitation),
    );
  }

  async cancelInvitation(
    parentGroupId: string,
    invitationId: string,
    actor: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      await this.assertHierarchyInvite(em, actor, parentGroupId);

      const invitation = await this.loadInvitationOrFail(em, invitationId);
      if (invitation.parentGroup.id !== parentGroupId) {
        throw this.invitationNotFound();
      }
      this.assertPending(invitation);

      invitation.status = HierarchyInvitationStatus.CANCELLED;
      invitation.respondedAt = new Date();
      invitation.respondedBy = actor;
      await em.flush();

      this.auditLogService.record(em, {
        community: invitation.parentGroup,
        action: AuditAction.CANCEL_CHILD_INVITATION,
        actor,
        targetType: AuditTargetType.HIERARCHY_INVITATION,
        targetId: invitation.id,
      });
      await em.flush();
    });
  }

  // ─── HierarchyInvitation: list / accept / reject (target side) ──────────

  /** Pending invitations addressed to `targetId` - only its OWNER may act. */
  async listReceivedInvitations(
    targetId: string,
  ): Promise<HierarchyInvitationResponseDto[]> {
    const invitations = await this.em.find(
      HierarchyInvitation,
      {
        $or: [{ targetGroup: targetId }, { targetSection: targetId }],
        status: HierarchyInvitationStatus.PENDING,
      },
      {
        populate: [
          'parentGroup',
          'targetGroup',
          'targetSection',
          'invitedBy',
          'respondedBy',
        ],
        orderBy: { createdAt: 'desc' },
      },
    );
    return invitations.map((invitation) =>
      this.toInvitationResponseDto(invitation),
    );
  }

  /**
   * Accepts a PENDING invitation addressed to `targetId` - only its OWNER
   * may do so (HIERARCHY_MANAGE, checked here, not just by the route
   * guard). Performs the actual attach and the status change atomically, in
   * the same transaction, under a row lock on the invitation - a second,
   * concurrent accept/reject blocks on that lock and, once it acquires it,
   * observes the already-terminal status and is rejected, never
   * double-attaching.
   */
  async acceptInvitation(
    targetId: string,
    invitationId: string,
    actor: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      await this.assertHierarchyManage(em, actor, targetId);

      const invitation = await em.findOne(
        HierarchyInvitation,
        { id: invitationId },
        {
          populate: ['parentGroup', 'targetGroup', 'targetSection'],
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );
      if (!invitation) {
        throw this.invitationNotFound();
      }
      const target = invitation.targetGroup ?? invitation.targetSection;
      if (!target || target.id !== targetId) {
        throw this.invitationNotFound();
      }
      this.assertPending(invitation);

      // Re-validated here, not just trusted from invitation-creation time
      // (self-parent/cycle/parent-status may have changed since) -
      // attachChildGroup/attachSection perform this unconditionally.
      if (invitation.targetGroup) {
        await this.groupHierarchyService.attachChildGroup(
          invitation.targetGroup.id,
          invitation.parentGroup.id,
          em,
        );
      } else {
        await this.groupHierarchyService.attachSection(
          invitation.targetSection!.id,
          invitation.parentGroup.id,
          em,
        );
      }

      invitation.status = HierarchyInvitationStatus.ACCEPTED;
      invitation.respondedAt = new Date();
      invitation.respondedBy = actor;
      await em.flush();

      this.auditLogService.record(em, {
        community: invitation.parentGroup,
        action: AuditAction.ACCEPT_CHILD_INVITATION,
        actor,
        targetType: AuditTargetType.HIERARCHY_INVITATION,
        targetId: invitation.id,
        metadata: { targetId },
      });
      await em.flush();
    });
  }

  /** Rejects a PENDING invitation addressed to `targetId` - OWNER only. */
  async rejectInvitation(
    targetId: string,
    invitationId: string,
    actor: User,
  ): Promise<void> {
    await this.em.transactional(async (em) => {
      await this.assertHierarchyManage(em, actor, targetId);

      const invitation = await em.findOne(
        HierarchyInvitation,
        { id: invitationId },
        {
          populate: ['parentGroup', 'targetGroup', 'targetSection'],
          lockMode: LockMode.PESSIMISTIC_WRITE,
        },
      );
      if (!invitation) {
        throw this.invitationNotFound();
      }
      const target = invitation.targetGroup ?? invitation.targetSection;
      if (!target || target.id !== targetId) {
        throw this.invitationNotFound();
      }
      this.assertPending(invitation);

      invitation.status = HierarchyInvitationStatus.REJECTED;
      invitation.respondedAt = new Date();
      invitation.respondedBy = actor;
      await em.flush();

      this.auditLogService.record(em, {
        community: invitation.parentGroup,
        action: AuditAction.REJECT_CHILD_INVITATION,
        actor,
        targetType: AuditTargetType.HIERARCHY_INVITATION,
        targetId: invitation.id,
        metadata: { targetId },
      });
      await em.flush();
    });
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private toRef(community: Community): HierarchyEntityRefDto {
    return {
      id: community.id,
      type: community instanceof Group ? 'GROUP' : 'SECTION',
      name: community.name,
    };
  }

  private toInvitationResponseDto(
    invitation: HierarchyInvitation,
  ): HierarchyInvitationResponseDto {
    const target = (invitation.targetGroup ?? invitation.targetSection)!;
    return {
      id: invitation.id,
      parentGroup: this.toRef(invitation.parentGroup),
      target: this.toRef(target),
      invitedBy: invitation.invitedBy
        ? {
            id: invitation.invitedBy.id,
            displayName: invitation.invitedBy.displayName,
          }
        : null,
      status: invitation.status,
      createdAt: invitation.createdAt.toISOString(),
      respondedAt: invitation.respondedAt
        ? invitation.respondedAt.toISOString()
        : null,
      respondedBy: invitation.respondedBy
        ? {
            id: invitation.respondedBy.id,
            displayName: invitation.respondedBy.displayName,
          }
        : null,
    };
  }

  /**
   * Resolves the caller's authorization for `communityId` and asserts they
   * hold HIERARCHY_MANAGE there - the shared gate for every direct
   * attach/move/detach and target-side accept/reject. Not a duplicate of
   * GroupPermissionsGuard: the guard only ever checks the route's own :id
   * param, while attach/move additionally need this for the *other* side of
   * the relationship (the parent, arriving in the body) - and every mutation
   * here re-verifies its own route-side id too, inside the transaction, for
   * defense-in-depth against a TOCTOU race with the pre-transaction guard
   * check.
   */
  private async assertHierarchyManage(
    em: EntityManager,
    actor: User,
    communityId: string,
  ): Promise<Community> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        communityId,
        actor.id,
        em,
      );
    if (!authorization) {
      throw this.communityNotFound();
    }
    this.assertPermission(authorization, GroupPermission.HIERARCHY_MANAGE);
    return authorization.community;
  }

  /** Same as assertHierarchyManage, but for HIERARCHY_INVITE on a Group. */
  private async assertHierarchyInvite(
    em: EntityManager,
    actor: User,
    groupId: string,
  ): Promise<Group> {
    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        groupId,
        actor.id,
        em,
      );
    if (!authorization || !(authorization.community instanceof Group)) {
      throw this.groupNotFound();
    }
    this.assertPermission(authorization, GroupPermission.HIERARCHY_INVITE);
    return authorization.community;
  }

  private assertPermission(
    authorization: ResolvedGroupAuthorization,
    permission: GroupPermission,
  ): void {
    const targetKind: PermissionTargetKind =
      authorization.community instanceof Group ? 'GROUP' : 'SECTION';
    const roles = authorization.roleAssignments.map(
      (roleAssignment) => roleAssignment.role,
    );
    const allowed = this.groupPermissionService.hasAllPermissionsForRoles(
      targetKind,
      roles,
      [permission],
      authorization.membership?.status ?? null,
    );
    if (!allowed) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_GROUP_PERMISSIONS',
        message: 'Insufficient permissions in this group',
      });
    }
  }

  private assertPending(invitation: HierarchyInvitation): void {
    if (invitation.status !== HierarchyInvitationStatus.PENDING) {
      throw new ConflictException({
        code: 'HIERARCHY_INVITATION_NOT_PENDING',
        message: `This invitation is already ${invitation.status.toLowerCase()} and cannot be processed again`,
      });
    }
  }

  private async loadInvitationOrFail(
    em: EntityManager,
    invitationId: string,
  ): Promise<HierarchyInvitation> {
    const invitation = await em.findOne(
      HierarchyInvitation,
      { id: invitationId },
      { populate: ['parentGroup', 'targetGroup', 'targetSection'] },
    );
    if (!invitation) {
      throw this.invitationNotFound();
    }
    return invitation;
  }

  private communityNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }

  private invitationNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'HIERARCHY_INVITATION_NOT_FOUND',
      message: 'Hierarchy invitation not found',
    });
  }

  private alreadyAttached(): ConflictException {
    return new ConflictException({
      code: 'ALREADY_ATTACHED',
      message: 'This relation already exists',
    });
  }

  private notAttached(): ConflictException {
    return new ConflictException({
      code: 'NOT_ATTACHED',
      message: 'This entity has no parent to detach from',
    });
  }

  private cycleDetected(): ConflictException {
    return new ConflictException({
      code: 'GROUP_HIERARCHY_CYCLE',
      message: 'A cycle was detected in the group hierarchy',
    });
  }
}
