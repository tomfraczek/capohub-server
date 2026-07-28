import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityNotificationSettingsResponseDto } from './dto/community-notification-settings-response.dto';
import { UpdateCommunityNotificationSettingsInput } from './dto/update-community-notification-settings.schema';
import { CommunityNotificationSettings } from './entities/community-notification-settings.entity';
import { Group } from './entities/group.entity';
import { GroupHierarchyService } from './group-hierarchy.service';
import { loadActiveMembership } from './group-membership.query';

// Every read/write here is scoped to the caller's *own* row - there is no
// membershipId/userId param anywhere in this service, unlike every
// administrative action elsewhere in this module. This mirrors
// GroupPermission.NOTIFICATION_SETTINGS_MANAGE being granted to every Role
// (see group-role-permissions.map.ts): a plain MEMBER manages their own
// preferences exactly the same way an OWNER does.
//
// Deliberately does NOT go through GroupPermissionsGuard/RoleAssignment
// resolution (unlike every other endpoint in this module): that guard
// requires at least one Role Assignment to resolve authorization for a
// Group at all (see RoleAssignmentsService.resolveAuthorization), which
// would make this feature unreachable for the well-documented, valid case
// of a Group Membership with zero Role Assignments
// (organization-entities.md#membership) - exactly the member this feature
// most needs to work for, since they still belong to the Group and
// still receive its notifications. Authorization here is checked directly
// against Membership instead (ACTIVE only, mirroring loadActiveMembership -
// consistent with NOTIFICATION_SETTINGS_MANAGE being deliberately excluded
// from READ_ONLY_SAFE_PERMISSIONS elsewhere).
//
// Settings are always resolved against the Root Group regardless of which
// exact Group's id the caller passed (see CommunityNotificationSettings) -
// there is one notification-preferences row per (user, Group), not
// per Child Group.
@Injectable()
export class CommunityNotificationSettingsService {
  constructor(
    private readonly em: EntityManager,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  async get(
    groupId: string,
    user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    const rootGroup = await this.assertMemberOrFail(this.em, groupId, user.id);
    const settings = await this.em.findOne(CommunityNotificationSettings, {
      community: rootGroup.id,
      user: user.id,
    });
    return toResponseDto(rootGroup.id, settings);
  }

  async update(
    groupId: string,
    user: User,
    input: UpdateCommunityNotificationSettingsInput,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.em.transactional(async (em) => {
      const rootGroup = await this.assertMemberOrFail(em, groupId, user.id);

      let settings = await em.findOne(CommunityNotificationSettings, {
        community: rootGroup.id,
        user: user.id,
      });
      if (!settings) {
        settings = new CommunityNotificationSettings();
        settings.community = rootGroup;
        settings.user = user;
        em.persist(settings);
      }

      Object.assign(settings, input);
      await em.flush();

      return toResponseDto(rootGroup.id, settings);
    });
  }

  // Confirms `groupId` is itself a root Group (see the Group/Section rename
  // ADR - notification settings are one row per (user, Group), never per
  // Section) and that the caller has an ACTIVE Membership there. A Section
  // id 404s explicitly here rather than silently resolving to its Root
  // Group's settings, which is what this used to do before it was made
  // explicit. Never confirms the Group's existence to a non-member (404
  // either way), same convention as GroupPermissionsGuard.
  private async assertMemberOrFail(
    em: EntityManager,
    groupId: string,
    userId: string,
  ): Promise<Group> {
    const rootGroup = await this.groupHierarchyService.getRootGroup(
      groupId,
      em,
    );
    if (rootGroup.id !== groupId) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }
    const membership = await loadActiveMembership(em, rootGroup.id, userId);
    if (!membership) {
      throw new NotFoundException({
        code: 'GROUP_NOT_FOUND',
        message: 'Group not found',
      });
    }
    return rootGroup;
  }
}

function toResponseDto(
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
  };
}
