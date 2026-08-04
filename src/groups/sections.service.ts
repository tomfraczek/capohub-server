import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { generateUniquePublicCode } from '../common/utils/public-code';
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
import { SectionMembership } from './entities/section-membership.entity';
import { GroupHierarchyService } from './group-hierarchy.service';
import { toSectionResponseDto } from './mappers/section.mapper';
import { RoleAssignmentsService } from './role-assignments.service';

// A Section is its own entity type, physically separate from Group (see
// the organizational-domain rebuild, stage 1) - it may have at most one
// parent Group (never another Section) and can never have children of its
// own. This service is the Section-facing counterpart to GroupsService;
// the two intentionally duplicate a modest amount of lifecycle-transition
// logic rather than share it, since a Group and a Section expose different
// response DTOs and are reached through different route families.
@Injectable()
export class SectionsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupHierarchyService: GroupHierarchyService,
    private readonly auditLogService: AuditLogService,
  ) {}

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
    const section = await this.em.transactional(async (em) => {
      const parent = await em.findOne(Group, { id: parentId });
      if (!parent) {
        throw this.notFound();
      }
      if (parent.status === GroupStatus.ARCHIVED) {
        throw new ConflictException({
          code: 'GROUP_ARCHIVED',
          message:
            'This group is archived and is read-only until it is restored',
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

      const section = new Section();
      section.publicCode = await generateUniquePublicCode(em);
      this.applyFields(section, input);
      section.parentGroup = parent;
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
      await em.flush();

      return section;
    });

    return toSectionResponseDto(section);
  }

  async list(parentId: string): Promise<SectionResponseDto[]> {
    const sections = await this.em.find(Section, { parentGroup: parentId });
    return sections.map(toSectionResponseDto);
  }

  async getById(sectionId: string): Promise<SectionResponseDto> {
    const section = await this.loadOrFail(sectionId);
    return toSectionResponseDto(section);
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
      return toSectionResponseDto(section);
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
      return toSectionResponseDto(section);
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
      return toSectionResponseDto(section);
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
    section.timezone = input.timezone;
    section.currencyCode = input.currencyCode;
    section.country = input.country;
    section.city = input.city;
    section.region = input.region;
    section.geonameId = input.geonameId;
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
