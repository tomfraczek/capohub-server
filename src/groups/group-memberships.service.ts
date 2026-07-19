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
import {
  GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  GroupMembership,
} from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { loadActiveMembership } from './group-membership.query';
import { toGroupMembershipResponseDto } from './mappers/group.mapper';

@Injectable()
export class GroupMembershipsService {
  constructor(private readonly em: EntityManager) {}

  async listMembers(groupId: string): Promise<GroupMembershipResponseDto[]> {
    const memberships = await this.em.find(
      GroupMembership,
      { group: groupId, status: GroupMembershipStatus.ACTIVE },
      { populate: ['user'], orderBy: { joinedAt: 'asc' } },
    );

    return memberships.map(toGroupMembershipResponseDto);
  }

  // "Technical" add only - no invitation/acceptance flow (spec section
  // "Dodanie członka"). OWNER can never be assigned here - see
  // assignableGroupRoleSchema.
  async addMember(
    groupId: string,
    input: AddMemberInput,
  ): Promise<GroupMembershipResponseDto> {
    return this.em.transactional(async (em) => {
      const user = await em.findOne(User, { id: input.userId });
      if (!user) {
        throw new BadRequestException({
          code: 'USER_NOT_FOUND',
          message: 'No user exists with the given userId',
        });
      }

      const existing = await loadActiveMembership(em, groupId, input.userId);
      if (existing) {
        throw new ConflictException({
          code: 'ALREADY_A_MEMBER',
          message: 'This user is already an active member of the group',
        });
      }

      const membership = new GroupMembership();
      membership.group = em.getReference(Group, groupId);
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

      return toGroupMembershipResponseDto(membership);
    });
  }

  async changeRole(
    groupId: string,
    membershipId: string,
    input: ChangeMemberRoleInput,
  ): Promise<GroupMembershipResponseDto> {
    const membership = await this.loadActiveMembershipByIdOrFail(
      groupId,
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
    return toGroupMembershipResponseDto(membership);
  }

  async removeMember(groupId: string, membershipId: string): Promise<void> {
    const membership = await this.loadActiveMembershipByIdOrFail(
      groupId,
      membershipId,
    );

    if (membership.role === GroupRole.OWNER) {
      throw new ConflictException({
        code: 'CANNOT_REMOVE_OWNER',
        message: 'The owner cannot be removed - transfer ownership first',
      });
    }

    membership.status = GroupMembershipStatus.REMOVED;
    membership.leftAt = new Date();
    await this.em.flush();
  }

  async leave(groupId: string, userId: string): Promise<void> {
    const membership = await loadActiveMembership(this.em, groupId, userId);
    if (!membership) {
      throw this.membershipNotFound();
    }

    if (membership.role === GroupRole.OWNER) {
      throw new ConflictException({
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
        message: 'Transfer ownership before leaving the group',
      });
    }

    membership.status = GroupMembershipStatus.LEFT;
    membership.leftAt = new Date();
    await this.em.flush();
  }

  async transferOwnership(
    groupId: string,
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
        groupId,
        currentOwnerUserId,
      );
      if (!previousOwner || previousOwner.role !== GroupRole.OWNER) {
        throw this.membershipNotFound();
      }

      const newOwner = await loadActiveMembership(
        em,
        groupId,
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
        previousOwner: toGroupMembershipResponseDto(previousOwner),
        newOwner: toGroupMembershipResponseDto(newOwner),
      };
    });
  }

  private async loadActiveMembershipByIdOrFail(
    groupId: string,
    membershipId: string,
  ): Promise<GroupMembership> {
    const membership = await this.em.findOne(
      GroupMembership,
      {
        id: membershipId,
        group: groupId,
        status: GroupMembershipStatus.ACTIVE,
      },
      { populate: ['user'] },
    );
    if (!membership) {
      throw this.membershipNotFound();
    }
    return membership;
  }

  private membershipNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'MEMBERSHIP_NOT_FOUND',
      message: 'Group membership not found',
    });
  }
}
