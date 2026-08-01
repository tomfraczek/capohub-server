import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { CreateRecipientGroupInput } from './dto/create-recipient-group.schema';
import { RecipientGroupResponseDto } from './dto/recipient-group-response.dto';
import { UpdateRecipientGroupInput } from './dto/update-recipient-group.schema';
import { Group } from './entities/group.entity';
import {
  RECIPIENT_GROUPS_ACTIVE_NAME_UNIQUE_INDEX,
  RecipientGroup,
} from './entities/recipient-group.entity';
import { RecipientGroupMember } from './entities/recipient-group-member.entity';
import { toRecipientGroupResponseDto } from './mappers/recipient-group.mapper';
import { RoleAssignmentsService } from './role-assignments.service';

// Recipient Group existence/status of its *Group* is already enforced by
// GroupPermissionsGuard (via :groupId/:sectionId) before any handler here
// runs, same convention as AcademiesService/CohortsService - this service
// only resolves its own entities and the one extra rule those two don't
// need: every member must already be in scope for the owning Group/Section
// (see RoleAssignmentsService.isCommunityMember).
@Injectable()
export class RecipientGroupsService {
  constructor(
    private readonly em: EntityManager,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  async create(
    communityGroupId: string,
    input: CreateRecipientGroupInput,
    actor: User,
  ): Promise<RecipientGroupResponseDto> {
    return this.em.transactional(async (em) => {
      await this.assertMembersInScope(
        em,
        communityGroupId,
        input.memberUserIds,
      );

      const recipientGroup = new RecipientGroup();
      recipientGroup.group = em.getReference(Group, communityGroupId);
      recipientGroup.name = input.name;
      recipientGroup.createdBy = actor;

      try {
        await em.persist(recipientGroup).flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, RECIPIENT_GROUPS_ACTIVE_NAME_UNIQUE_INDEX)
        ) {
          throw this.nameTaken();
        }
        throw error;
      }

      const members = await this.replaceMembers(
        em,
        recipientGroup,
        input.memberUserIds,
      );
      return toRecipientGroupResponseDto(recipientGroup, members);
    });
  }

  async list(communityGroupId: string): Promise<RecipientGroupResponseDto[]> {
    const recipientGroups = await this.em.find(
      RecipientGroup,
      { group: communityGroupId },
      { orderBy: { createdAt: 'asc' } },
    );
    const membersByGroup = await this.loadMembersByGroup(
      this.em,
      recipientGroups.map((rg) => rg.id),
    );
    return recipientGroups.map((rg) =>
      toRecipientGroupResponseDto(rg, membersByGroup.get(rg.id) ?? []),
    );
  }

  async getById(
    communityGroupId: string,
    recipientGroupId: string,
  ): Promise<RecipientGroupResponseDto> {
    const recipientGroup = await this.loadOrFail(
      this.em,
      communityGroupId,
      recipientGroupId,
    );
    const members = await this.loadMembers(this.em, recipientGroupId);
    return toRecipientGroupResponseDto(recipientGroup, members);
  }

  async update(
    communityGroupId: string,
    recipientGroupId: string,
    input: UpdateRecipientGroupInput,
  ): Promise<RecipientGroupResponseDto> {
    return this.em.transactional(async (em) => {
      const recipientGroup = await this.loadOrFail(
        em,
        communityGroupId,
        recipientGroupId,
      );
      await this.assertMembersInScope(
        em,
        communityGroupId,
        input.memberUserIds,
      );

      recipientGroup.name = input.name;
      try {
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, RECIPIENT_GROUPS_ACTIVE_NAME_UNIQUE_INDEX)
        ) {
          throw this.nameTaken();
        }
        throw error;
      }

      const members = await this.replaceMembers(
        em,
        recipientGroup,
        input.memberUserIds,
      );
      return toRecipientGroupResponseDto(recipientGroup, members);
    });
  }

  /**
   * Reactivating can now collide: since the active-name uniqueness index
   * only constrains active rows (see recipient-group.entity.ts), a new
   * Recipient Group may already have been created reusing this exact
   * (now-inactive) name in the meantime - the same conflict create()/
   * update() already guard against, just reached by flipping `isActive`
   * instead of writing `name`.
   */
  async activate(
    communityGroupId: string,
    recipientGroupId: string,
  ): Promise<RecipientGroupResponseDto> {
    const recipientGroup = await this.loadOrFail(
      this.em,
      communityGroupId,
      recipientGroupId,
    );
    recipientGroup.isActive = true;
    try {
      await this.em.flush();
    } catch (error) {
      if (
        isUniqueViolationOn(error, RECIPIENT_GROUPS_ACTIVE_NAME_UNIQUE_INDEX)
      ) {
        throw this.nameTaken();
      }
      throw error;
    }
    const members = await this.loadMembers(this.em, recipientGroupId);
    return toRecipientGroupResponseDto(recipientGroup, members);
  }

  async deactivate(
    communityGroupId: string,
    recipientGroupId: string,
  ): Promise<RecipientGroupResponseDto> {
    const recipientGroup = await this.loadOrFail(
      this.em,
      communityGroupId,
      recipientGroupId,
    );
    recipientGroup.isActive = false;
    await this.em.flush();
    const members = await this.loadMembers(this.em, recipientGroupId);
    return toRecipientGroupResponseDto(recipientGroup, members);
  }

  /**
   * Resolves a Recipient Group for use as an Announcement's recipient -
   * must exist, belong to exactly `communityGroupId` (never a different
   * Group/Section, even one the same actor also administers - see
   * AnnouncementsService.create), and be active (see recipient-group.entity.ts
   * - "cannot be selected for a *new* Announcement" once deactivated).
   */
  async loadActiveForCommunity(
    communityGroupId: string,
    recipientGroupId: string,
  ): Promise<RecipientGroup> {
    const recipientGroup = await this.loadOrFail(
      this.em,
      communityGroupId,
      recipientGroupId,
    );
    if (!recipientGroup.isActive) {
      throw new ConflictException({
        code: 'RECIPIENT_GROUP_INACTIVE',
        message:
          'This recipient group is deactivated and cannot be used for a new announcement',
      });
    }
    return recipientGroup;
  }

  /**
   * Every current member's user id - used only to build the immutable
   * snapshot at Announcement publish time (see
   * AnnouncementsService.create/AnnouncementRecipient) - never re-read
   * afterward for an already-published Announcement's recipients.
   */
  async listMemberUserIds(recipientGroupId: string): Promise<string[]> {
    const members = await this.em.find(RecipientGroupMember, {
      recipientGroup: recipientGroupId,
    });
    return members.map((member) => member.user.id);
  }

  private async assertMembersInScope(
    em: EntityManager,
    communityGroupId: string,
    memberUserIds: string[],
  ): Promise<void> {
    for (const userId of memberUserIds) {
      const inScope = await this.roleAssignmentsService.isCommunityMember(
        communityGroupId,
        userId,
        em,
      );
      if (!inScope) {
        throw new BadRequestException({
          code: 'RECIPIENT_GROUP_MEMBER_OUT_OF_SCOPE',
          message: `User ${userId} is not a member of this group/section`,
        });
      }
    }
  }

  private async replaceMembers(
    em: EntityManager,
    recipientGroup: RecipientGroup,
    memberUserIds: string[],
  ): Promise<User[]> {
    await em.nativeDelete(RecipientGroupMember, {
      recipientGroup: recipientGroup.id,
    });
    for (const userId of memberUserIds) {
      const member = new RecipientGroupMember();
      member.recipientGroup = recipientGroup;
      member.user = em.getReference(User, userId);
      em.persist(member);
    }
    await em.flush();
    return this.loadMembers(em, recipientGroup.id);
  }

  private async loadMembers(
    em: EntityManager,
    recipientGroupId: string,
  ): Promise<User[]> {
    const members = await em.find(
      RecipientGroupMember,
      { recipientGroup: recipientGroupId },
      { populate: ['user'] },
    );
    return members.map((member) => member.user);
  }

  private async loadMembersByGroup(
    em: EntityManager,
    recipientGroupIds: string[],
  ): Promise<Map<string, User[]>> {
    if (recipientGroupIds.length === 0) {
      return new Map();
    }
    const members = await em.find(
      RecipientGroupMember,
      { recipientGroup: { $in: recipientGroupIds } },
      { populate: ['user'] },
    );
    const result = new Map<string, User[]>();
    for (const member of members) {
      const groupId = member.recipientGroup.id;
      const list = result.get(groupId) ?? [];
      list.push(member.user);
      result.set(groupId, list);
    }
    return result;
  }

  private async loadOrFail(
    em: EntityManager,
    communityGroupId: string,
    recipientGroupId: string,
  ): Promise<RecipientGroup> {
    const recipientGroup = await em.findOne(
      RecipientGroup,
      { id: recipientGroupId, group: communityGroupId },
      { populate: ['group', 'createdBy'] },
    );
    if (!recipientGroup) {
      throw new NotFoundException({
        code: 'RECIPIENT_GROUP_NOT_FOUND',
        message: 'Recipient group not found',
      });
    }
    return recipientGroup;
  }

  private nameTaken(): ConflictException {
    return new ConflictException({
      code: 'RECIPIENT_GROUP_NAME_TAKEN',
      message: 'A recipient group with this name already exists here',
    });
  }
}
