import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';
import { GroupPermissionService } from './group-permission.service';

describe('GroupPermissionService', () => {
  let service: GroupPermissionService;

  beforeEach(() => {
    service = new GroupPermissionService();
  });

  describe('hasPermission', () => {
    it('returns true when the role has the permission', () => {
      expect(
        service.hasPermission(GroupRole.MEMBER, GroupPermission.GROUP_VIEW),
      ).toBe(true);
    });

    it('returns false when the role lacks the permission', () => {
      expect(
        service.hasPermission(GroupRole.MEMBER, GroupPermission.GROUP_EDIT),
      ).toBe(false);
    });

    it('returns true for a permission inherited from a lower tier', () => {
      expect(
        service.hasPermission(GroupRole.OWNER, GroupPermission.GROUP_VIEW),
      ).toBe(true);
    });

    it('withholds every lifecycle-status and ownership-transfer permission from ADMIN', () => {
      expect(
        service.hasPermission(GroupRole.ADMIN, GroupPermission.GROUP_ARCHIVE),
      ).toBe(false);
      expect(
        service.hasPermission(GroupRole.ADMIN, GroupPermission.GROUP_UNARCHIVE),
      ).toBe(false);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.GROUP_SET_READ_ONLY,
        ),
      ).toBe(false);
      expect(
        service.hasPermission(GroupRole.ADMIN, GroupPermission.GROUP_ACTIVATE),
      ).toBe(false);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.GROUP_OWNERSHIP_TRANSFER,
        ),
      ).toBe(false);
    });

    it('grants ADMIN the membership-, academy- and section-management permissions', () => {
      expect(
        service.hasPermission(GroupRole.ADMIN, GroupPermission.MEMBERSHIP_ADD),
      ).toBe(true);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_ROLE_CHANGE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_REMOVE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.MEMBERSHIP_SECTION_ASSIGN,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(GroupRole.ADMIN, GroupPermission.ACADEMY_CREATE),
      ).toBe(true);
      expect(
        service.hasPermission(GroupRole.ADMIN, GroupPermission.SECTION_CREATE),
      ).toBe(true);
    });

    it('gives INSTRUCTOR and ASSISTANT the same permissions as MEMBER', () => {
      expect(service.getPermissionsForRole(GroupRole.INSTRUCTOR)).toEqual(
        service.getPermissionsForRole(GroupRole.MEMBER),
      );
      expect(service.getPermissionsForRole(GroupRole.ASSISTANT)).toEqual(
        service.getPermissionsForRole(GroupRole.MEMBER),
      );
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true when every permission matches', () => {
      expect(
        service.hasAllPermissions(GroupRole.ADMIN, [
          GroupPermission.GROUP_VIEW,
          GroupPermission.GROUP_EDIT,
        ]),
      ).toBe(true);
    });

    it('returns false when at least one permission is missing', () => {
      expect(
        service.hasAllPermissions(GroupRole.ADMIN, [
          GroupPermission.GROUP_EDIT,
          GroupPermission.GROUP_ARCHIVE,
        ]),
      ).toBe(false);
    });

    it('returns true for an empty permission list', () => {
      expect(service.hasAllPermissions(GroupRole.MEMBER, [])).toBe(true);
    });
  });

  describe('getPermissionsForRole', () => {
    it('returns every GroupPermission for OWNER', () => {
      expect(
        [...service.getPermissionsForRole(GroupRole.OWNER)].sort(),
      ).toEqual([...Object.values(GroupPermission)].sort());
    });
  });

  describe('hasAllPermissionsForRoles', () => {
    it('grants the full union of every held Role permission set when the membership is ACTIVE', () => {
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.ADMIN],
          [GroupPermission.GROUP_EDIT, GroupPermission.MEMBERSHIP_ADD],
          GroupMembershipStatus.ACTIVE,
        ),
      ).toBe(true);
    });

    it('unions permissions across several simultaneously held Roles (e.g. MEMBER + ADMIN)', () => {
      // ADMIN alone already implies MEMBER's tier in this map, but the
      // union must hold even if a Role's permissions did not overlap.
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.MEMBER, GroupRole.ADMIN],
          [GroupPermission.GROUP_VIEW, GroupPermission.GROUP_EDIT],
          GroupMembershipStatus.ACTIVE,
        ),
      ).toBe(true);
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.MEMBER],
          [GroupPermission.GROUP_EDIT],
          GroupMembershipStatus.ACTIVE,
        ),
      ).toBe(false);
    });

    it('restricts to the view-only subset when the membership is READ_ONLY', () => {
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          GroupMembershipStatus.READ_ONLY,
        ),
      ).toBe(true);
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.OWNER],
          [GroupPermission.GROUP_EDIT],
          GroupMembershipStatus.READ_ONLY,
        ),
      ).toBe(false);
    });

    it('grants nothing when the membership is INVITED', () => {
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          GroupMembershipStatus.INVITED,
        ),
      ).toBe(false);
    });

    it('grants nothing when the membership is ARCHIVED - a Role Assignment has no effective access once its Membership has ended', () => {
      expect(
        service.hasAllPermissionsForRoles(
          [GroupRole.OWNER],
          [GroupPermission.GROUP_VIEW],
          GroupMembershipStatus.ARCHIVED,
        ),
      ).toBe(false);
    });

    it('returns true for an empty roles list only if no permissions are required', () => {
      expect(
        service.hasAllPermissionsForRoles([], [], GroupMembershipStatus.ACTIVE),
      ).toBe(true);
      expect(
        service.hasAllPermissionsForRoles(
          [],
          [GroupPermission.GROUP_VIEW],
          GroupMembershipStatus.ACTIVE,
        ),
      ).toBe(false);
    });
  });
});
