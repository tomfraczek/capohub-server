import { CommunityListVisibility } from './enums/community-list-visibility.enum';
import { GroupRole } from './enums/group-role.enum';
import { canSeeSectionMembers } from './section-members-visibility';

describe('canSeeSectionMembers', () => {
  it('lets every member see a PUBLIC members list', () => {
    expect(
      canSeeSectionMembers(
        { membersVisibility: CommunityListVisibility.PUBLIC },
        [GroupRole.MEMBER],
      ),
    ).toBe(true);
  });

  it('limits a PRIVATE members list to the staff - OWNER, ADMIN, INSTRUCTOR', () => {
    const section = { membersVisibility: CommunityListVisibility.PRIVATE };
    for (const role of [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.INSTRUCTOR,
    ]) {
      expect(canSeeSectionMembers(section, [GroupRole.MEMBER, role])).toBe(
        true,
      );
    }
    expect(canSeeSectionMembers(section, [GroupRole.MEMBER])).toBe(false);
    expect(
      canSeeSectionMembers(section, [GroupRole.MEMBER, GroupRole.ASSISTANT]),
    ).toBe(false);
  });
});
