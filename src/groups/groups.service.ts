import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
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

@Injectable()
export class GroupsService {
  constructor(private readonly em: EntityManager) {}

  // The creator automatically becomes OWNER (spec: "Po utworzeniu grupy
  // użytkownik automatycznie staje się OWNER") - group + its first
  // membership are created atomically, there is no window where a group
  // exists without an owner.
  async create(user: User, input: CreateGroupInput): Promise<GroupResponseDto> {
    const group = await this.em.transactional(async (em) => {
      const group = new Group();
      this.applyFields(group, input);

      const membership = new GroupMembership();
      membership.group = group;
      membership.user = user;
      membership.role = GroupRole.OWNER;
      membership.joinedAt = new Date();

      await em.persist([group, membership]).flush();
      return group;
    });

    return toGroupResponseDto(group);
  }

  async listMine(userId: string): Promise<GroupSummaryResponseDto[]> {
    const memberships = await this.em.find(
      GroupMembership,
      { user: userId, status: GroupMembershipStatus.ACTIVE },
      { populate: ['group'], orderBy: { joinedAt: 'desc' } },
    );

    return memberships.map((membership) =>
      toGroupSummaryResponseDto(membership.group, membership.role),
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
  // applying the new status. Memberships are never touched by any of these
  // four transitions (spec: archiving/restoring must not create, remove, or
  // re-role any GroupMembership).
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

  private applyFields(group: Group, input: CreateGroupInput): void {
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
    group.visibility = input.visibility;
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
