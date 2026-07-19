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

    it('grants ADMIN the member-management permissions', () => {
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.GROUP_MEMBER_ADD,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.GROUP_MEMBER_ROLE_CHANGE,
        ),
      ).toBe(true);
      expect(
        service.hasPermission(
          GroupRole.ADMIN,
          GroupPermission.GROUP_MEMBER_REMOVE,
        ),
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
});
