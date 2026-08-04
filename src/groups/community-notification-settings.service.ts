import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityNotificationSettingsResponseDto } from './dto/community-notification-settings-response.dto';
import { UpdateCommunityNotificationSettingsInput } from './dto/update-community-notification-settings.schema';
import { CommunityNotificationSettings } from './entities/community-notification-settings.entity';
import { Section } from './entities/section.entity';
import { loadActiveSectionMembership } from './section-membership.query';

// Every read/write here is scoped to the caller's *own* row - there is no
// membershipId/userId param anywhere in this service, unlike every
// administrative action elsewhere in this module. A plain MEMBER manages
// their own preferences exactly the same way an OWNER does.
//
// Section-only: Group has no membership at all, so there is no "own"
// notification-preferences row to manage there - a Group id 404s here, the
// same way a non-Section id would 404 anywhere else in this module. This
// deliberately does NOT go through GroupPermissionsGuard/RoleAssignment
// resolution: that requires at least one active RoleAssignment to resolve
// authorization at all, which would make this feature unreachable for a
// plain member holding only the base MEMBER role with no additional Role -
// exactly the member this feature most needs to work for, since they still
// belong to the Section and still receive its notifications. Authorization
// here is checked directly against SectionMembership instead (ACTIVE only).
@Injectable()
export class CommunityNotificationSettingsService {
  constructor(private readonly em: EntityManager) {}

  async get(
    sectionId: string,
    user: User,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    const section = await this.assertMemberOrFail(this.em, sectionId, user.id);
    const settings = await this.em.findOne(CommunityNotificationSettings, {
      community: section.id,
      user: user.id,
    });
    return toResponseDto(section.id, settings);
  }

  async update(
    sectionId: string,
    user: User,
    input: UpdateCommunityNotificationSettingsInput,
  ): Promise<CommunityNotificationSettingsResponseDto> {
    return this.em.transactional(async (em) => {
      const section = await this.assertMemberOrFail(em, sectionId, user.id);

      let settings = await em.findOne(CommunityNotificationSettings, {
        community: section.id,
        user: user.id,
      });
      if (!settings) {
        settings = new CommunityNotificationSettings();
        settings.community = section;
        settings.user = user;
        em.persist(settings);
      }

      Object.assign(settings, input);
      await em.flush();

      return toResponseDto(section.id, settings);
    });
  }

  // Confirms `sectionId` is actually a Section (Group has no notification
  // settings of its own - see the class comment) and that the caller has
  // an ACTIVE SectionMembership there. Never confirms the Section's
  // existence to a non-member (404 either way), same convention as
  // GroupPermissionsGuard.
  private async assertMemberOrFail(
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

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
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
