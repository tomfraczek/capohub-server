import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { ImageAssetService } from '../storage/image-asset.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import {
  buildGroupCoverImageKey,
  buildGroupProfileImageKey,
} from '../storage/object-keys.util';
import { R2StorageService } from '../storage/r2-storage.service';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { CreateGroupInput } from './dto/create-group.schema';
import { GroupResponseDto } from './dto/group-response.dto';
import { GroupSummaryResponseDto } from './dto/group-summary-response.dto';
import { UpdateGroupInput } from './dto/update-group.schema';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import {
  FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX,
  FormalGroupAffiliation,
} from './entities/formal-group-affiliation.entity';
import { GroupFollowService } from './group-follow.service';
import {
  toGroupResponseDto,
  toGroupSummaryResponseDto,
} from './mappers/group.mapper';
import { RoleAssignmentsService } from './role-assignments.service';
import { userOwnsGroup } from './user-owns-group';

@Injectable()
export class GroupsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly auditLogService: AuditLogService,
    private readonly r2StorageService: R2StorageService,
    private readonly imageProcessingService: ImageProcessingService,
    private readonly imageAssetService: ImageAssetService,
    private readonly groupFollowService: GroupFollowService,
  ) {}

  // PUT /groups/:id/profile-image (module: "R2: upload/replace/delete
  // zdjęć" §16/§18) - gated by GroupPermission.GROUP_EDIT, same as
  // update() (see groups.controller.ts). Clears the legacy logoUrl column
  // alongside setting profileImageKey (module spec §28) - see
  // group.entity.ts's logoUrl comment for why: it keeps the two fields
  // from ever disagreeing about which is authoritative, and is what makes
  // a later DELETE correctly return to "no logo" instead of resurrecting
  // whatever logoUrl held before the first R2 upload (module spec §27).
  async uploadProfileImage(
    groupId: string,
    file: Express.Multer.File,
  ): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    const processed = await this.imageProcessingService.processProfileImage(
      file.buffer,
    );
    const newKey = buildGroupProfileImageKey(group.id);
    await this.imageAssetService.replace({
      processedBuffer: processed,
      newKey,
      oldKey: group.profileImageKey,
      persist: async (key) => {
        group.profileImageKey = key;
        group.logoUrl = null;
        await this.em.flush();
      },
      logContext: { resourceType: 'group-profile-image', resourceId: group.id },
    });
    return this.toResponseDto(this.em, group);
  }

  // DELETE /groups/:id/profile-image - idempotent (module spec §42): a
  // Group with no R2 profile image simply returns its current state, no
  // DB write. logoUrl is deliberately NOT restored here (module spec §27 -
  // "delete nie może powodować powrotu do wcześniej zastąpionego starego
  // legacy logo") - it already went null the moment the R2 image was
  // uploaded (see uploadProfileImage above), so there is nothing to
  // restore, only profileImageKey to clear.
  async deleteProfileImage(groupId: string): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    await this.imageAssetService.remove({
      oldKey: group.profileImageKey,
      persist: async () => {
        group.profileImageKey = null;
        await this.em.flush();
      },
      logContext: { resourceType: 'group-profile-image', resourceId: group.id },
    });
    return this.toResponseDto(this.em, group);
  }

  // PUT /groups/:id/cover-image - same shape/gating as uploadProfileImage
  // above, just for the cover image (16:9, see
  // ImageProcessingService.processCoverImage) instead of the square
  // profile image. Clears the legacy coverImageUrl column alongside
  // setting coverImageKey, same "the two fields never disagree" reasoning
  // as logoUrl/profileImageKey (see group.entity.ts).
  async uploadCoverImage(
    groupId: string,
    file: Express.Multer.File,
  ): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    const processed = await this.imageProcessingService.processCoverImage(
      file.buffer,
    );
    const newKey = buildGroupCoverImageKey(group.id);
    await this.imageAssetService.replace({
      processedBuffer: processed,
      newKey,
      oldKey: group.coverImageKey,
      persist: async (key) => {
        group.coverImageKey = key;
        group.coverImageUrl = null;
        await this.em.flush();
      },
      logContext: { resourceType: 'group-cover-image', resourceId: group.id },
    });
    return this.toResponseDto(this.em, group);
  }

  // DELETE /groups/:id/cover-image - idempotent, same as
  // deleteProfileImage above.
  async deleteCoverImage(groupId: string): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    await this.imageAssetService.remove({
      oldKey: group.coverImageKey,
      persist: async () => {
        group.coverImageKey = null;
        await this.em.flush();
      },
      logContext: { resourceType: 'group-cover-image', resourceId: group.id },
    });
    return this.toResponseDto(this.em, group);
  }

  // The creator automatically becomes OWNER (spec: "Po utworzeniu grupy
  // użytkownik automatycznie staje się OWNER") - Group and its creator's
  // OWNER Role Assignment are created atomically, so there is no window
  // where a Group exists without an owner. A Group always gets exactly one
  // OWNER this way - enforced not just by this code path but by
  // ROLE_ASSIGNMENTS_OWNER_UNIQUE_INDEX. Group has no membership at all -
  // unlike a Section, the creator does not receive MEMBER (Group has no
  // such role - see group-role-permissions.map.ts); OWNER is their only
  // Role Assignment here.
  //
  // A user may have at most one *active* formal Group (see
  // formal-group-affiliation.entity.ts): creating a Group is the other way
  // (besides UserProfileService.setFormalGroup) a FormalGroupAffiliation
  // comes into being, so a user who already has one is blocked outright -
  // USER_ALREADY_HAS_FORMAL_GROUP, 409 - before anything is written. This
  // is the one path that creates a FormalGroupAffiliation without first
  // requiring a SectionMembership in the target Group: the creator's OWNER
  // grant is itself a strong enough tie that making them join/create a
  // Section of their own Group first, purely to satisfy
  // setFormalGroup's usual qualifying-membership check, would be
  // pointless ceremony. UserProfileService.setFormalGroup's own
  // SectionMembership requirement is untouched for every other case
  // (changing to/setting an *existing* Group as formal).
  //
  // Group, OWNER RoleAssignment and FormalGroupAffiliation are all created
  // in one transaction - if the affiliation insert fails (including the
  // FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX race backstop below), the
  // whole transaction rolls back, so a Group/OWNER is never left orphaned
  // without its founder's formal affiliation.
  //
  // A Group is always root-level. Creating a Section (nested under an
  // existing Group or Section, which always creates a real membership) is
  // a different operation - see SectionsService.create.
  async create(user: User, input: CreateGroupInput): Promise<GroupResponseDto> {
    const group = await this.em.transactional(async (em) => {
      const existingAffiliation = await em.findOne(FormalGroupAffiliation, {
        user: user.id,
        endedOn: null,
      });
      if (existingAffiliation) {
        throw new ConflictException({
          code: 'USER_ALREADY_HAS_FORMAL_GROUP',
          message:
            'You already have an active formal group - leave/change it before creating a new one',
        });
      }
      if (await userOwnsGroup(em, user.id)) {
        throw new ConflictException({
          code: 'USER_ALREADY_OWNS_GROUP',
          message: 'You already own a group - a user may own only one',
        });
      }

      const group = new Group();
      group.publicCode = await generateUniquePublicCode(em);
      this.applyFields(group, input);
      group.parentGroup = null;
      // Permanent founder record (see Group.founderUser's own comment) -
      // set once, here, alongside the OWNER RoleAssignment below, and
      // never touched again by anything (not transferOwnership, not
      // update()).
      group.founderUser = user;
      group.founderNameSnapshot = user.displayName;
      em.persist(group);

      await this.roleAssignmentsService.insertRoleAssignment(
        em,
        user,
        group,
        GroupRole.OWNER,
        user,
      );

      const affiliation = new FormalGroupAffiliation();
      affiliation.user = user;
      affiliation.group = group;
      affiliation.startedOn = null;
      try {
        em.persist(affiliation);
        await em.flush();
      } catch (error) {
        // Race backstop - see the equivalent comment in
        // UserProfileService.setFormalGroup.
        if (
          isUniqueViolationOn(
            error,
            FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX,
          )
        ) {
          throw new ConflictException({
            code: 'USER_ALREADY_HAS_FORMAL_GROUP',
            message: 'A concurrent change already set an active formal group',
          });
        }
        throw error;
      }

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

    return this.toResponseDto(this.em, group, user.id);
  }

  async listMine(userId: string): Promise<GroupSummaryResponseDto[]> {
    // Group participation is purely RoleAssignment-based - no membership
    // concept at all, so there is no status to gate on the way Section
    // does (READ_ONLY/ARCHIVED). A revoked (former) Role Assignment is
    // already excluded by getGroupParticipationForUsers.
    const participation =
      await this.roleAssignmentsService.getGroupParticipationForUsers([userId]);
    if (participation.length === 0) {
      return [];
    }

    const groups = await this.em.find(Group, {
      id: { $in: participation.map((row) => row.groupId) },
    });
    const groupsById = new Map(groups.map((group) => [group.id, group]));

    return participation
      .map((row) => groupsById.get(row.groupId))
      .filter((group): group is Group => group !== undefined)
      .map((group) => {
        const roles =
          participation.find((row) => row.groupId === group.id)?.roles ?? [];
        return toGroupSummaryResponseDto(group, roles, this.r2StorageService);
      });
  }

  async getById(groupId: string, viewer: User): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    return this.toResponseDto(this.em, group, viewer.id);
  }

  // POST /groups/:id/follow - see group-follow.entity.ts/GroupFollowService
  // for what "following" means (never a membership, no role/permission
  // granted). Idempotent - following an already-followed Group just returns
  // its current state. Reachable only where GroupPermission.GROUP_VIEW
  // already passed (see groups.controller.ts) - i.e. only for a Group the
  // caller can already see (public, or one they administer) - a private
  // Group the caller cannot view is not followable either, same 404 the
  // guard already gives for viewing it.
  async follow(groupId: string, user: User): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    await this.groupFollowService.follow(user, group);
    return this.toResponseDto(this.em, group, user.id);
  }

  // DELETE /groups/:id/follow - idempotent (unfollowing an already-not-
  // followed Group is a success, not a 404/409).
  async unfollow(groupId: string, user: User): Promise<GroupResponseDto> {
    const group = await this.loadGroupOrFail(groupId);
    await this.groupFollowService.unfollow(user.id, groupId);
    return this.toResponseDto(this.em, group, user.id);
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
      return this.toResponseDto(em, group, actor.id);
    });
  }

  // Whether the current status is actually allowed to move to the target
  // one is already decided before this ever runs - GroupPermissionsGuard
  // checks it via each endpoint's @AllowGroupStatuses(...)
  // (groups.controller.ts), so there is nothing left to validate here beyond
  // applying the new status. Memberships and Role Assignments are never
  // touched by any of these transitions (Delete included - see ADR-029).
  //
  // Archive is what the app presents as "Usuń grupę": the Group disappears
  // for users but stays as a historical row (joins, Events, Career
  // Timeline entries referencing it keep resolving). Its child Groups and
  // Sections are never archived along with it - each is detached and
  // becomes standalone again, exactly as before it joined (same
  // DETACH_CHILD audit as HierarchyManagementService.detachGroup/
  // detachSection), all in one transaction with the status change. Only
  // DELETED children (already gone for good) are left alone.
  async archive(groupId: string, actor: User): Promise<GroupResponseDto> {
    return this.em.transactional(async (em) => {
      const group = await this.loadGroupOrFail(groupId, em);

      const childGroups = await em.find(Group, { parentGroup: groupId });
      const sections = await em.find(Section, { parentGroup: groupId });
      for (const child of [...childGroups, ...sections]) {
        if (child.status === GroupStatus.DELETED) continue;
        child.parentGroup = null;
        this.auditLogService.record(em, {
          community: group,
          action: AuditAction.DETACH_CHILD,
          actor,
          targetType: AuditTargetType.COMMUNITY,
          targetId: child.id,
          metadata: { previousParentId: group.id, newParentId: null },
        });
      }

      group.status = GroupStatus.ARCHIVED;
      this.recordCommunityAudit(em, group, AuditAction.ARCHIVE, actor);
      await em.flush();
      return this.toResponseDto(em, group, actor.id);
    });
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

      // "Children" means both child Groups and direct Sections - deleting a
      // Group must not silently orphan either kind of substructure under a
      // now-permanently-gone parent.
      const childGroups = await em.find(Group, { parentGroup: groupId });
      const sections = await em.find(Section, { parentGroup: groupId });
      const activeChildren = [...childGroups, ...sections].filter(
        (child) =>
          child.status !== GroupStatus.ARCHIVED &&
          child.status !== GroupStatus.DELETED,
      );
      if (activeChildren.length > 0) {
        throw new ConflictException({
          code: 'GROUP_HAS_ACTIVE_CHILDREN',
          message:
            'Archive or delete every child group and section before deleting this one',
          childGroupIds: activeChildren.map((child) => child.id),
        });
      }

      group.status = GroupStatus.DELETED;
      this.recordCommunityAudit(em, group, AuditAction.DELETE, actor);
      await em.flush();
      return this.toResponseDto(em, group, actor.id);
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
      return this.toResponseDto(em, group, actor.id);
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
    group.followersVisibility = input.followersVisibility;
  }

  // childGroupsCount/directSectionsCount are direct-children counts only
  // (see GroupResponseDto) - queried fresh rather than relying on
  // Group.childGroups/sections' Collection state, which is not loaded by
  // default.
  //
  // `viewerId` is optional: every mutation call site (create/update/
  // archive/.../delete) already has the acting User at hand and passes it
  // through for free, so isMemberThroughSection/isFollowing are correct
  // there too; the profile-image upload/delete handlers do not carry a
  // viewer today and simply get `false`/`false` back for these two fields -
  // a safe default, since those responses are not the "view a Group's
  // profile" surface these flags exist for (see getById, the real target of
  // this feature).
  private async toResponseDto(
    em: EntityManager,
    group: Group,
    viewerId?: string,
  ): Promise<GroupResponseDto> {
    // Sequential, not Promise.all - two queries issued concurrently on the
    // same EntityManager/connection race each other at the driver level
    // (see the pg deprecation warning this used to trigger under load).
    const childGroupsCount = await em.count(Group, { parentGroup: group.id });
    const directSectionsCount = await em.count(Section, {
      parentGroup: group.id,
    });
    const relation = viewerId
      ? await this.resolveViewerRelation(em, group.id, viewerId)
      : { isMemberThroughSection: false, isFollowing: false };
    return toGroupResponseDto(
      group,
      { childGroupsCount, directSectionsCount },
      relation,
      this.r2StorageService,
    );
  }

  /**
   * `isMemberThroughSection` - a User belongs to Group A "through a
   * Section" only when they hold an active (ACTIVE/READ_ONLY)
   * SectionMembership in one of Group A's *direct* Sections
   * (`section.parentGroup === group.id`) - deliberately not the whole
   * hierarchy subtree: this codebase's established rule is "no inheritance
   * in either direction" (see CommunityHomeService's own comment - joining
   * a Section never implicates any Group beyond its own immediate parent).
   * `isFollowing` is the entirely independent GroupFollow signal (see
   * group-follow.entity.ts) - the two are combined here only for the
   * response DTO, never derived from one another.
   */
  private async resolveViewerRelation(
    em: EntityManager,
    groupId: string,
    viewerId: string,
  ): Promise<{ isMemberThroughSection: boolean; isFollowing: boolean }> {
    // Sequential, not Promise.all - see this file's other queries' own
    // comment on why concurrent queries against the same
    // EntityManager/connection are never issued together here.
    const membership = await em.findOne(SectionMembership, {
      user: viewerId,
      section: { parentGroup: groupId },
      status: {
        $in: [
          SectionMembershipStatus.ACTIVE,
          SectionMembershipStatus.READ_ONLY,
        ],
      },
    });
    const isFollowing = await this.groupFollowService.isFollowing(
      viewerId,
      groupId,
    );
    return { isMemberThroughSection: membership !== null, isFollowing };
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
