import { CommunityListVisibility } from './enums/community-list-visibility.enum';
import { GroupRole } from './enums/group-role.enum';
import { Section } from './entities/section.entity';

// A Section's staff - the roles that always see its members list, even
// when Section.membersVisibility is PRIVATE.
export const SECTION_MEMBERS_STAFF_ROLES: readonly GroupRole[] = [
  GroupRole.OWNER,
  GroupRole.ADMIN,
  GroupRole.INSTRUCTOR,
];

/**
 * Whether a caller holding `roles` in `section` (and already holding
 * MEMBERSHIP_VIEW there) may see its members list. Shared by the members
 * endpoints (SectionMembershipsService) and the matching
 * canViewMembersInSectionIds capability (CommunityHomeService), so the two
 * can never disagree.
 */
export function canSeeSectionMembers(
  section: Pick<Section, 'membersVisibility'>,
  roles: readonly GroupRole[],
): boolean {
  if (section.membersVisibility === CommunityListVisibility.PUBLIC) {
    return true;
  }
  return roles.some((role) => SECTION_MEMBERS_STAFF_ROLES.includes(role));
}
