import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { AddMemberInput } from './dto/add-member.schema';
import { ChangeMemberRoleInput } from './dto/change-member-role.schema';
import { GroupMembershipResponseDto } from './dto/group-membership-response.dto';
import { TransferOwnershipInput } from './dto/transfer-ownership.schema';
import { TransferOwnershipResponseDto } from './dto/transfer-ownership-response.dto';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { MembershipEndReason } from './enums/membership-end-reason.enum';
import { SectionStatus } from './enums/section-status.enum';
import {
  GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  GroupMembership,
} from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { MembershipSection } from './entities/membership-section.entity';
import { Section } from './entities/section.entity';
import { GroupHierarchyService } from './group-hierarchy.service';
import { loadActiveMembership } from './group-membership.query';
import {
  toGroupMembershipResponseDto,
  toMembershipSectionRefDto,
} from './mappers/group.mapper';

const MEMBERSHIP_SECTIONS_UNIQUE_INDEX =
  'membership_sections_membership_id_section_id_unique';

@Injectable()
export class GroupMembershipsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  async listMembers(
    rootGroupId: string,
  ): Promise<GroupMembershipResponseDto[]> {
    const memberships = await this.em.find(
      GroupMembership,
      { rootGroup: rootGroupId, status: GroupMembershipStatus.ACTIVE },
      { populate: ['user'], orderBy: { joinedAt: 'asc' } },
    );

    return this.toResponseDtos(memberships);
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
    return this.toResponseDto(membership);
  }

  // "Technical" add only - no invitation/acceptance flow (spec section
  // "Dodanie członka"). OWNER can never be assigned here - see
  // assignableGroupRoleSchema. Membership always represents participation
  // in an organization as a whole - rootGroupId must reference an actual
  // Root Group (see organization-entities.md#membership), never a Child
  // Group.
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
      membership.role = input.role;
      membership.joinedAt = new Date();

      try {
        await em.persist(membership).flush();
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

      return this.toResponseDto(membership);
    });
  }

  async changeRole(
    rootGroupId: string,
    membershipId: string,
    input: ChangeMemberRoleInput,
  ): Promise<GroupMembershipResponseDto> {
    const membership = await this.loadActiveMembershipByIdOrFail(
      this.em,
      rootGroupId,
      membershipId,
    );

    // The owner's role can only change through transferOwnership, which
    // simultaneously assigns a new owner - never leaving the group without
    // exactly one (spec: admin cannot change the owner, cannot grant
    // ownership).
    if (membership.role === GroupRole.OWNER) {
      throw new ConflictException({
        code: 'CANNOT_CHANGE_OWNER_ROLE',
        message:
          'Use the ownership transfer endpoint to change the role of the owner',
      });
    }

    membership.role = input.role;
    await this.em.flush();
    return this.toResponseDto(membership);
  }

  // Ends the Membership because the organization removed the member -
  // never a hard delete (ADR-007). Distinguished from a self-service
  // leave() only by `endReason`, since the documented status set has no
  // separate REMOVED state (see GroupMembershipStatus).
  async removeMember(rootGroupId: string, membershipId: string): Promise<void> {
    const membership = await this.loadActiveMembershipByIdOrFail(
      this.em,
      rootGroupId,
      membershipId,
    );

    if (membership.role === GroupRole.OWNER) {
      throw new ConflictException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'The owner cannot be removed - transfer ownership first',
      });
    }

    membership.status = GroupMembershipStatus.ARCHIVED;
    membership.leftAt = new Date();
    membership.endReason = MembershipEndReason.REMOVED;
    await this.em.flush();
  }

  // Self-service leave - any member (including, per spec, everyone except
  // the OWNER, who must transfer ownership first) may end their own
  // Membership without an administrative permission.
  async leave(rootGroupId: string, userId: string): Promise<void> {
    const membership = await loadActiveMembership(this.em, rootGroupId, userId);
    if (!membership) {
      throw this.membershipNotFound();
    }

    if (membership.role === GroupRole.OWNER) {
      throw new ConflictException({
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
        message: 'Transfer ownership before leaving the group',
      });
    }

    membership.status = GroupMembershipStatus.ARCHIVED;
    membership.leftAt = new Date();
    membership.endReason = MembershipEndReason.LEFT;
    await this.em.flush();
  }

  async transferOwnership(
    rootGroupId: string,
    currentOwnerUserId: string,
    input: TransferOwnershipInput,
  ): Promise<TransferOwnershipResponseDto> {
    if (input.newOwnerUserId === currentOwnerUserId) {
      throw new BadRequestException({
        code: 'CANNOT_TRANSFER_TO_SELF',
        message: 'newOwnerUserId must be a different member',
      });
    }

    return this.em.transactional(async (em) => {
      const previousOwner = await loadActiveMembership(
        em,
        rootGroupId,
        currentOwnerUserId,
      );
      if (!previousOwner || previousOwner.role !== GroupRole.OWNER) {
        throw this.membershipNotFound();
      }

      const newOwner = await loadActiveMembership(
        em,
        rootGroupId,
        input.newOwnerUserId,
      );
      if (!newOwner) {
        throw new BadRequestException({
          code: 'TARGET_NOT_A_MEMBER',
          message:
            'newOwnerUserId must already be an active member of the group',
        });
      }

      previousOwner.role = input.previousOwnerRole;
      newOwner.role = GroupRole.OWNER;
      await em.flush();

      return {
        previousOwner: await this.toResponseDto(previousOwner),
        newOwner: await this.toResponseDto(newOwner),
      };
    });
  }

  // Assigning a Section requires the Membership to be ACTIVE, and the
  // Section to belong to the same Root Group as the Membership (it may
  // belong to any Group within that organization's tree - see
  // GroupHierarchyService.getRootGroup) and not be archived. See
  // organization-entities.md#section.
  async assignSection(
    rootGroupId: string,
    membershipId: string,
    sectionId: string,
  ): Promise<void> {
    return this.em.transactional(async (em) => {
      const membership = await this.loadMembershipByIdOrFail(
        em,
        rootGroupId,
        membershipId,
      );
      this.assertMembershipIsActive(membership);

      const section = await em.findOne(Section, { id: sectionId });
      if (!section) {
        throw new NotFoundException({
          code: 'SECTION_NOT_FOUND',
          message: 'Section not found',
        });
      }
      if (section.status === SectionStatus.ARCHIVED) {
        throw new ConflictException({
          code: 'MEMBERSHIP_SECTION_ARCHIVED',
          message: 'This section is archived and cannot accept new members',
        });
      }

      const sectionRoot = await this.groupHierarchyService.getRootGroup(
        section.group.id,
      );
      if (sectionRoot.id !== rootGroupId) {
        throw new BadRequestException({
          code: 'MEMBERSHIP_SECTION_MISMATCH',
          message:
            "This section does not belong to the membership's Root Group",
        });
      }

      const existing = await em.findOne(MembershipSection, {
        membership: membershipId,
        section: sectionId,
      });
      if (existing) {
        throw new ConflictException({
          code: 'MEMBERSHIP_SECTION_ALREADY_ASSIGNED',
          message: 'This member is already assigned to this section',
        });
      }

      const assignment = new MembershipSection();
      assignment.membership = em.getReference(GroupMembership, membershipId);
      assignment.section = em.getReference(Section, sectionId);

      try {
        await em.persist(assignment).flush();
      } catch (error) {
        // Race backstop - see the equivalent comment in addMember().
        if (isUniqueViolationOn(error, MEMBERSHIP_SECTIONS_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'MEMBERSHIP_SECTION_ALREADY_ASSIGNED',
            message: 'This member is already assigned to this section',
          });
        }
        throw error;
      }
    });
  }

  async unassignSection(
    rootGroupId: string,
    membershipId: string,
    sectionId: string,
  ): Promise<void> {
    await this.loadMembershipByIdOrFail(this.em, rootGroupId, membershipId);

    const assignment = await this.em.findOne(MembershipSection, {
      membership: membershipId,
      section: sectionId,
    });
    if (!assignment) {
      throw new NotFoundException({
        code: 'MEMBERSHIP_SECTION_ASSIGNMENT_NOT_FOUND',
        message: 'This member is not assigned to this section',
      });
    }

    await this.em.remove(assignment).flush();
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
  ): Promise<GroupMembership> {
    const membership = await em.findOne(
      GroupMembership,
      {
        id: membershipId,
        rootGroup: rootGroupId,
        status: GroupMembershipStatus.ACTIVE,
      },
      { populate: ['user'] },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  // Unlike loadActiveMembershipByIdOrFail, does not filter by status - a
  // membership that has ended is still a valid target for getMembership()
  // and for the membership-status checks in assignSection/unassignSection
  // (which need to distinguish "not found" from "found but not active").
  private async loadMembershipByIdOrFail(
    em: EntityManager,
    rootGroupId: string,
    membershipId: string,
  ): Promise<GroupMembership> {
    const membership = await em.findOne(
      GroupMembership,
      { id: membershipId, rootGroup: rootGroupId },
      { populate: ['user'] },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  private async toResponseDto(
    membership: GroupMembership,
  ): Promise<GroupMembershipResponseDto> {
    const sections = await this.loadSectionRefs([membership.id]);
    return toGroupMembershipResponseDto(
      membership,
      sections.get(membership.id) ?? [],
    );
  }

  private async toResponseDtos(
    memberships: GroupMembership[],
  ): Promise<GroupMembershipResponseDto[]> {
    const sectionsByMembership = await this.loadSectionRefs(
      memberships.map((membership) => membership.id),
    );
    return memberships.map((membership) =>
      toGroupMembershipResponseDto(
        membership,
        sectionsByMembership.get(membership.id) ?? [],
      ),
    );
  }

  private async loadSectionRefs(
    membershipIds: string[],
  ): Promise<Map<string, ReturnType<typeof toMembershipSectionRefDto>[]>> {
    if (membershipIds.length === 0) {
      return new Map();
    }

    const assignments = await this.em.find(
      MembershipSection,
      { membership: { $in: membershipIds } },
      { populate: ['section'] },
    );

    const byMembership = new Map<
      string,
      ReturnType<typeof toMembershipSectionRefDto>[]
    >();
    for (const assignment of assignments) {
      const membershipId = assignment.membership.id;
      const refs = byMembership.get(membershipId) ?? [];
      refs.push(toMembershipSectionRefDto(assignment.section));
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
