import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityNotificationSettingsResponseDto } from './dto/community-notification-settings-response.dto';
import { GroupNotificationSettingsResponseDto } from './dto/group-notification-settings-response.dto';
import { UpdateCommunityNotificationSettingsInput } from './dto/update-community-notification-settings.schema';
import { UpdateGroupNotificationSettingsInput } from './dto/update-group-notification-settings.schema';
import { CommunityNotificationSettings } from './entities/community-notification-settings.entity';
import { Group } from './entities/group.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { Section } from './entities/section.entity';
import { loadActiveSectionMembership } from './section-membership.query';

// Every read/write here is scoped to the caller's *own* row - there is no
// membershipId/userId param anywhere in this service, unlike every
// administrative action elsewhere in this module. A plain MEMBER manages
// their own preferences exactly the same way an OWNER does.
//
// Two parallel surfaces sharing the same entity/table
// (CommunityNotificationSettings - see its own comment on the Group/Section
// dual-nullable-FK shape):
//  - get()/update() - Section, the original, full-shape surface.
//  - getForGroup()/updateForGroup() - Group, minimal {muted}-only surface
//    (module spec § GROUP NOTIFICATION SETTINGS).
// Neither goes through GroupPermissionsGuard/RoleAssignment-based
// permission resolution: for Section, that guard requires at least one
// active RoleAssignment to resolve authorization at all, which would make
// this feature unreachable for a plain member holding only the base MEMBER
// role with no additional Role - exactly the member this feature most
// needs to work for. For Group, there is no such base role either (a Group
// participant holds *only* whatever Role was explicitly granted - see
// assertGroupParticipantOrFail) so the same reasoning applies: any active
// Role is enough to reach and manage this, no specific permission required.
@Injectable()
export class CommunityNotificationSettingsService {
  constructor(private readonly em: EntityManager) {}

  // ─── Section ────────────────────────────────────────────────────────────

  async get(
    sectionId: string,
    user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    const section = await this.assertSectionMemberOrFail(
      this.em,
      sectionId,
      user.id,
    );
    const settings = await this.em.findOne(CommunityNotificationSettings, {
      communitySection: section.id,
      user: user.id,
    });
    return toSectionResponseDto(section.id, settings);
  }

  async update(
    sectionId: string,
    user: User,
    input: UpdateCommunityNotificationSettingsInput,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await this.assertSectionMemberOrFail(
        em,
        sectionId,
        user.id,
      );

      let settings = await em.findOne(CommunityNotificationSettings, {
        communitySection: section.id,
        user: user.id,
      });
      if (!settings) {
        settings = new CommunityNotificationSettings();
        settings.communitySection = section;
        settings.user = user;
        em.persist(settings);
      }

      Object.assign(settings, input);
      await em.flush();

      return toSectionResponseDto(section.id, settings);
    });
  }

  // ─── Group ──────────────────────────────────────────────────────────────

  async getForGroup(
    groupId: string,
    user: User,
  ): Promise<GroupNotificationSettingsResponseDto> {
    const group = await this.assertGroupParticipantOrFail(
      this.em,
      groupId,
      user.id,
    );
    const settings = await this.em.findOne(CommunityNotificationSettings, {
      communityGroup: group.id,
      user: user.id,
    });
    return toGroupResponseDto(group.id, settings);
  }

  async updateForGroup(
    groupId: string,
    user: User,
    input: UpdateGroupNotificationSettingsInput,
  ): Promise<GroupNotificationSettingsResponseDto> {
    return this.em.transactional(async (em) => {
      const group = await this.assertGroupParticipantOrFail(
        em,
        groupId,
        user.id,
      );

      let settings = await em.findOne(CommunityNotificationSettings, {
        communityGroup: group.id,
        user: user.id,
      });
      if (!settings) {
        settings = new CommunityNotificationSettings();
        settings.communityGroup = group;
        settings.user = user;
        em.persist(settings);
      }

      Object.assign(settings, input);
      await em.flush();

      return toGroupResponseDto(group.id, settings);
    });
  }

  // ─── Access checks ──────────────────────────────────────────────────────

  // Confirms `sectionId` is actually a Section and that the caller has an
  // ACTIVE SectionMembership there. Never confirms the Section's existence
  // to a non-member (404 either way), same convention as
  // GroupPermissionsGuard.
  private async assertSectionMemberOrFail(
    em: EntityManager,
    sectionId: string,
    userId: string,
  ): Promise<Section> {
    const section = await em.findOne(Section, { id: sectionId });
    if (!section) {
      throw this.sectionNotFound();
    }
    const membership = await loadActiveSectionMembership(
      em,
      section.id,
      userId,
    );
    if (!membership) {
      throw this.sectionNotFound();
    }
    return section;
  }

  // Confirms `groupId` is actually a Group and that the caller holds at
  // least one active RoleAssignment there - Group has no membership at all
  // (see MembershipRequestsService.groupHasNoMembership), so any granted
  // Role (not just ADMIN/OWNER) is what "belongs to this Group" means here,
  // mirroring the Section check's own "any active relationship, not a
  // specific permission" reasoning. Never confirms the Group's existence to
  // a non-participant (404 either way).
  private async assertGroupParticipantOrFail(
    em: EntityManager,
    groupId: string,
    userId: string,
  ): Promise<Group> {
    const group = await em.findOne(Group, { id: groupId });
    if (!group) {
      throw this.groupNotFound();
    }
    const roleCount = await em.count(RoleAssignment, {
      group: groupId,
      user: userId,
      revokedAt: null,
    });
    if (roleCount === 0) {
      throw this.groupNotFound();
    }
    return group;
  }

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}

function toSectionResponseDto(
  communityId: string,
  settings: CommunityNotificationSettings | null,
): CommunityNotificationSettingsResponseDto {
  // No row yet = every default (see CommunityNotificationSettings field
  // defaults) - viewing settings never creates a row, only an explicit
  // update does.
  return {
    communityId,
    newJoinRequests: settings?.newJoinRequests ?? true,
    joinRequestApproved: settings?.joinRequestApproved ?? true,
    newInvitations: settings?.newInvitations ?? true,
    invitationAccepted: settings?.invitationAccepted ?? true,
    invitationRejected: settings?.invitationRejected ?? true,
    roleChanges: settings?.roleChanges ?? true,
    transferOwnership: settings?.transferOwnership ?? true,
    archived: settings?.archived ?? true,
    restored: settings?.restored ?? true,
    communityDeleted: settings?.communityDeleted ?? true,
    muted: settings?.muted ?? false,
  };
}

function toGroupResponseDto(
  communityId: string,
  settings: CommunityNotificationSettings | null,
): GroupNotificationSettingsResponseDto {
  return {
    communityId,
    muted: settings?.muted ?? false,
  };
}
