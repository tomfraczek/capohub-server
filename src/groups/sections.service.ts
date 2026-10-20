import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { getCityByGeonameId } from '../common/geo/city-directory';
import { generateUniquePublicCode } from '../common/utils/public-code';
import { ImageAssetService } from '../storage/image-asset.service';
import { ImageProcessingService } from '../storage/image-processing.service';
import {
  buildSectionCoverImageKey,
  buildSectionProfileImageKey,
} from '../storage/object-keys.util';
import { R2StorageService } from '../storage/r2-storage.service';
import { User } from '../users/entities/user.entity';
import { AuditLogService } from './audit-log.service';
import { CreateSectionInput } from './dto/create-section.schema';
import { SectionResponseDto } from './dto/section-response.dto';
import { UpdateSectionInput } from './dto/update-section.schema';
import { AuditAction } from './enums/audit-action.enum';
import { AuditTargetType } from './enums/audit-target-type.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { Group } from './entities/group.entity';
import { Section } from './entities/section.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { toSectionResponseDto } from './mappers/section.mapper';
import { RoleAssignmentsService } from './role-assignments.service';
import { resolveDisplayName } from '../users/display-name.util';

// A Section is its own entity type, physically separate from Group (see
// the organizational-domain rebuild, stage 1) - it may have at most one
// parent Group (never another Section) and can never have children of its
// own. This service is the Section-facing counterpart to GroupsService;
// the two intentionally duplicate a modest amount of lifecycle-transition
// logic rather than share it, since a Group and a Section expose different
// response DTOs and are reached through different route families.
//
// A Section may also have *no* parent at all - see ADR-032. create() and
// createStandalone() below are the two public entry points for that; both
// funnel through createInternal(), which is the single place that actually
// builds the Section row plus its creator's membership/roles, so nothing
// about that bootstrap can drift between the two paths.
@Injectable()
export class SectionsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly auditLogService: AuditLogService,
    private readonly r2StorageService: R2StorageService,
    private readonly imageProcessingService: ImageProcessingService,
    private readonly imageAssetService: ImageAssetService,
  ) {}

  // PUT :sectionId/profile-image - mirrors GroupsService.uploadProfileImage,
  // see that method's own comment for the replace-flow/legacy-clearing
  // rationale (module spec §16/§19).
  async uploadProfileImage(
    sectionId: string,
    file: Express.Multer.File,
  ): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(sectionId);
    const processed = await this.imageProcessingService.processProfileImage(
      file.buffer,
    );
    const newKey = buildSectionProfileImageKey(section.id);
    await this.imageAssetService.replace({
      processedBuffer: processed,
      newKey,
      oldKey: section.profileImageKey,
      persist: async (key) => {
        section.profileImageKey = key;
        section.logoUrl = null;
        await this.em.flush();
      },
      logContext: {
        resourceType: 'section-profile-image',
        resourceId: section.id,
      },
    });
    return this.toResponseDto(section);
  }

  // DELETE :sectionId/profile-image - mirrors
  // GroupsService.deleteProfileImage, see that method's own comment.
  async deleteProfileImage(sectionId: string): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(sectionId);
    await this.imageAssetService.remove({
      oldKey: section.profileImageKey,
      persist: async () => {
        section.profileImageKey = null;
        await this.em.flush();
      },
      logContext: {
        resourceType: 'section-profile-image',
        resourceId: section.id,
      },
    });
    return this.toResponseDto(section);
  }

  // PUT :sectionId/cover-image - mirrors GroupsService.uploadCoverImage,
  // same shape/gating as uploadProfileImage above, just for the cover
  // image (16:9, see ImageProcessingService.processCoverImage) instead of
  // the profile image. Clears the legacy coverImageUrl column alongside
  // setting coverImageKey, same "the two fields never disagree" reasoning
  // as logoUrl/profileImageKey (see section.entity.ts).
  async uploadCoverImage(
    sectionId: string,
    file: Express.Multer.File,
  ): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(sectionId);
    const processed = await this.imageProcessingService.processCoverImage(
      file.buffer,
    );
    const newKey = buildSectionCoverImageKey(section.id);
    await this.imageAssetService.replace({
      processedBuffer: processed,
      newKey,
      oldKey: section.coverImageKey,
      persist: async (key) => {
        section.coverImageKey = key;
        section.coverImageUrl = null;
        await this.em.flush();
      },
      logContext: {
        resourceType: 'section-cover-image',
        resourceId: section.id,
      },
    });
    return this.toResponseDto(section);
  }

  // DELETE :sectionId/cover-image - idempotent, mirrors
  // deleteProfileImage/GroupsService.deleteCoverImage above.
  async deleteCoverImage(sectionId: string): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(sectionId);
    await this.imageAssetService.remove({
      oldKey: section.coverImageKey,
      persist: async () => {
        section.coverImageKey = null;
        await this.em.flush();
      },
      logContext: {
        resourceType: 'section-cover-image',
        resourceId: section.id,
      },
    });
    return this.toResponseDto(section);
  }

  // The parent's existence and the caller's SECTION_CREATE permission there
  // are already established by GroupPermissionsGuard before this ever runs
  // (see SectionsController - the parent is always the route's :groupId).
  // A role on the parent Group only ever grants the *capability to create*
  // here - it is a deliberate, one-time bootstrap action, not inherited
  // membership: the new Section gets a brand-new SectionMembership for the
  // creator, created atomically with MEMBER+OWNER, exactly like joining any
  // other Section - never reusing anything from the parent (Group has no
  // membership to reuse in the first place - see RoleAssignmentsService).
  async create(
    parentId: string,
    actor: User,
    input: CreateSectionInput,
  ): Promise<SectionResponseDto> {
    return this.createInternal(parentId, actor, input);
  }

  // Standalone Section - no parent Group at all (see ADR-032 and
  // StandaloneSectionsController). Any authenticated user may call this,
  // mirroring GroupsService.create: there is no parent to hold
  // SECTION_CREATE against, so creating a standalone Section requires no
  // permission of its own. The creator gets exactly the same bootstrap
  // membership/roles as a Section created under a Group (see
  // createInternal) - parentGroup simply stays null until someone
  // (optionally, later) attaches it via HierarchyManagementService.
  async createStandalone(
    actor: User,
    input: CreateSectionInput,
  ): Promise<SectionResponseDto> {
    return this.createInternal(null, actor, input);
  }

  private async createInternal(
    parentId: string | null,
    actor: User,
    input: CreateSectionInput,
  ): Promise<SectionResponseDto> {
    const section = await this.em.transactional(async (em) => {
      const parent = parentId
        ? await this.resolveParentForCreate(em, parentId, actor)
        : null;

      const section = new Section();
      section.publicCode = await generateUniquePublicCode(em);
      this.applyFields(section, input);
      // currencyCode is seeded once, here, from the creating User's own
      // regional settings (module: "przy tworzeniu bierz z konta twórcy") -
      // never a client-supplied field (see create-section.schema.ts's own
      // comment) and never touched again by applyFields on a later update,
      // so an editor with a different account currency can never
      // accidentally change a Section's currency just by saving other
      // fields.
      section.currencyCode = actor.currencyCode;
      section.parentGroup = parent;
      // Permanent founder record (see Section.founderUser's own comment) -
      // set once, here, alongside the OWNER RoleAssignment below, for both
      // the under-a-Group and standalone creation paths, and never touched
      // again by anything (not transferOwnership, not update()).
      section.founderUser = actor;
      section.founderNameSnapshot = resolveDisplayName(actor);
      em.persist(section);

      const membership = new SectionMembership();
      membership.section = section;
      membership.user = actor;
      membership.joinedAt = new Date();
      em.persist(membership);

      await this.roleAssignmentsService.insertRoleAssignment(
        em,
        actor,
        section,
        GroupRole.MEMBER,
        actor,
      );
      await this.roleAssignmentsService.insertRoleAssignment(
        em,
        actor,
        section,
        GroupRole.OWNER,
        actor,
      );

      if (parent) {
        // Logged under the immediate parent, not a resolved root - "no
        // inheritance" applies to audit trails too (see AuditLogEntry's own
        // comment): CREATE_CHILD_GROUP describes something that happened to
        // *this exact* parent, not to whatever root sits above it.
        this.auditLogService.record(em, {
          community: parent,
          action: AuditAction.CREATE_CHILD_GROUP,
          actor,
          targetType: AuditTargetType.COMMUNITY,
          targetId: section.id,
        });
      } else {
        // No parent to file this under - logged under the Section itself,
        // exactly like GroupsService.create logs a new Group under itself
        // (CREATE_COMMUNITY, not CREATE_CHILD_GROUP - nothing "child" about
        // a standalone Section).
        this.auditLogService.record(em, {
          community: section,
          action: AuditAction.CREATE_COMMUNITY,
          actor,
          targetType: AuditTargetType.COMMUNITY,
          targetId: section.id,
        });
      }
      await em.flush();

      return section;
    });

    return this.toResponseDto(section);
  }

  private async resolveParentForCreate(
    em: EntityManager,
    parentId: string,
    actor: User,
  ): Promise<Group> {
    const parent = await em.findOne(Group, { id: parentId });
    if (!parent) {
      throw this.notFound();
    }
    if (parent.status === GroupStatus.ARCHIVED) {
      throw new ConflictException({
        code: 'GROUP_ARCHIVED',
        message: 'This group is archived and is read-only until it is restored',
      });
    }

    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        parentId,
        actor.id,
        em,
      );
    if (!authorization) {
      throw this.notFound();
    }
    return parent;
  }

  /**
   * `userId` is required (not just the guard's own SECTION_VIEW check)
   * because this list is reachable two ways since the Public-view fallback
   * (GroupPermissionsGuard/RoleAssignmentsService.resolvePublicView): a
   * real OWNER/ADMIN RoleAssignment on the parent Group (isCommunityMember
   * true), or a stranger viewing a `isPublic` Group with no RoleAssignment
   * at all. An OWNER/ADMIN still sees every child Section, exactly as
   * before - only a non-member view is narrowed to Sections not hidden
   * from Discover (`isHidden = false`). Not `isPublic`: a Section's
   * `isPublic` is "Dołączanie publiczne", not visibility (see
   * resolvePublicView), so an approval-only Section stays listed here.
   */
  async list(parentId: string, userId: string): Promise<SectionResponseDto[]> {
    const sections = await this.em.find(Section, { parentGroup: parentId });
    const isMember = await this.roleAssignmentsService.isCommunityMember(
      parentId,
      userId,
    );
    const visible = isMember
      ? sections
      : sections.filter((section) => !section.isHidden);
    // Sequential, not Promise.all - see toResponseDto's own comment.
    const dtos: SectionResponseDto[] = [];
    for (const section of visible) {
      dtos.push(await this.toResponseDto(section));
    }
    return dtos;
  }

  async getById(sectionId: string): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(sectionId);
    return this.toResponseDto(section);
  }

  async update(
    sectionId: string,
    input: UpdateSectionInput,
    actor: User,
  ): Promise<SectionResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await this.loadOrFail(sectionId, em);
      this.applyFields(section, input);
      this.recordCommunityAudit(
        em,
        section,
        AuditAction.UPDATE_COMMUNITY,
        actor,
      );
      await em.flush();
      return this.toResponseDto(section, em);
    });
  }

  async archive(sectionId: string, actor: User): Promise<SectionResponseDto> {
    return this.transitionStatus(
      sectionId,
      GroupStatus.ARCHIVED,
      actor,
      AuditAction.ARCHIVE,
    );
  }

  async unarchive(sectionId: string, actor: User): Promise<SectionResponseDto> {
    return this.transitionStatus(
      sectionId,
      GroupStatus.ACTIVE,
      actor,
      AuditAction.RESTORE,
    );
  }

  async setReadOnly(
    sectionId: string,
    actor: User,
  ): Promise<SectionResponseDto> {
    return this.transitionStatus(sectionId, GroupStatus.READ_ONLY, actor);
  }

  async activate(sectionId: string, actor: User): Promise<SectionResponseDto> {
    return this.transitionStatus(sectionId, GroupStatus.ACTIVE, actor);
  }

  // Mirrors GroupsService.delete - see its own comment for why this is a
  // status-only, historically-preserving change. Unlike a Group, a Section
  // can never have children, so there is no "active children" check here.
  async delete(sectionId: string, actor: User): Promise<SectionResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await this.loadOrFail(sectionId, em);
      section.status = GroupStatus.DELETED;
      this.recordCommunityAudit(em, section, AuditAction.DELETE, actor);
      await em.flush();
      return this.toResponseDto(section, em);
    });
  }

  private async transitionStatus(
    sectionId: string,
    target: GroupStatus,
    actor: User,
    auditAction?: AuditAction,
  ): Promise<SectionResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await this.loadOrFail(sectionId, em);
      section.status = target;
      if (auditAction) {
        this.recordCommunityAudit(em, section, auditAction, actor);
      }
      await em.flush();
      return this.toResponseDto(section, em);
    });
  }

  // Logged under the Section itself, never a resolved root - "no
  // inheritance" applies to audit trails too: a Section's own lifecycle
  // actions (archive/restore/delete/...) belong to its own history, not
  // its parent's (see AuditLogEntry's own comment). This also means a
  // standalone Section with no parent at all can be audited fine - there
  // is no root to resolve in the first place.
  private recordCommunityAudit(
    em: EntityManager,
    section: Section,
    action: AuditAction,
    actor: User,
  ): void {
    this.auditLogService.record(em, {
      community: section,
      action,
      actor,
      targetType: AuditTargetType.COMMUNITY,
      targetId: section.id,
    });
  }

  // membersCount = active (ACTIVE/READ_ONLY) SectionMemberships - same
  // "belongs here" definition as GroupsService.resolveViewerRelation.
  // Queried fresh per response, same as GroupsService.toResponseDto's own
  // counts; never issued concurrently on the same EntityManager.
  private async toResponseDto(
    section: Section,
    em: EntityManager = this.em,
  ): Promise<SectionResponseDto> {
    const membersCount = await em.count(SectionMembership, {
      section: section.id,
      status: {
        $in: [
          SectionMembershipStatus.ACTIVE,
          SectionMembershipStatus.READ_ONLY,
        ],
      },
    });
    // Prowadzący = active INSTRUCTOR RoleAssignments only (never
    // OWNER/ADMIN/ASSISTANT). Public Section info, independent of
    // membersVisibility - it exposes no member list, only this role's
    // holders. Earliest-granted first, so the order is stable.
    const instructorAssignments = await em.find(
      RoleAssignment,
      { section: section.id, role: GroupRole.INSTRUCTOR, revokedAt: null },
      { populate: ['user'], orderBy: { grantedAt: 'ASC', id: 'ASC' } },
    );
    const instructors = instructorAssignments.map((assignment) => ({
      id: assignment.user.id,
      displayName: resolveDisplayName(assignment.user),
    }));
    return toSectionResponseDto(
      section,
      { membersCount, instructors },
      this.r2StorageService,
    );
  }

  private applyFields(section: Section, input: CreateSectionInput): void {
    section.name = input.name;
    section.description = input.description;
    section.logoUrl = input.logoUrl;
    section.coverImageUrl = input.coverImageUrl;
    section.contactEmail = input.contactEmail;
    section.contactPhone = input.contactPhone;
    section.websiteUrl = input.websiteUrl;
    section.facebookUrl = input.facebookUrl;
    section.instagramUrl = input.instagramUrl;
    section.youtubeUrl = input.youtubeUrl;
    section.isPublic = input.isPublic;
    section.isHidden = input.isHidden;
    section.memberInvitesAllowed = input.memberInvitesAllowed;
    section.membersVisibility = input.membersVisibility;
    section.country = input.country;
    section.city = input.city;
    section.region = input.region;
    section.geonameId = input.geonameId;
    // Coordinates and timezone are never taken directly from client input -
    // there is no `input.latitude`/`input.longitude`/`input.timezone` at
    // all (see create-section.schema.ts's own comment) - geonameId is
    // already the cross-checked source of truth for country/city/region
    // (see refineCityIdentification), and the same bundled GeoNames dataset
    // it resolves against also carries that exact place's own
    // latitude/longitude and IANA timezone (see city-directory.ts) - so
    // deriving all three here is what guarantees a Section's location data
    // genuinely matches the place its geonameId names (root cause of
    // "Community Home empty for a new user": the mobile city picker never
    // sent latitude/longitude at all, so no create/update path ever
    // populated those two columns - see that feature's own report).
    // refineCityIdentification already ran in the schema layer and
    // guarantees getCityByGeonameId(input.geonameId) resolves here.
    // currencyCode is deliberately NOT set here at all - see
    // createInternal's own comment on why it is create-only.
    const cityRecord = getCityByGeonameId(input.geonameId);
    section.latitude = cityRecord?.latitude ?? null;
    section.longitude = cityRecord?.longitude ?? null;
    section.timezone = cityRecord?.timezone ?? section.timezone;
  }

  private async loadOrFail(
    sectionId: string,
    em: EntityManager = this.em,
  ): Promise<Section> {
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw this.notFound();
    }
    return section;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }
}
