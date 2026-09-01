import { GlobalRole } from './global-role.enum';
import { Permission } from './permission.enum';
import { PermissionService } from './permission.service';

describe('PermissionService', () => {
  let service: PermissionService;

  beforeEach(() => {
    service = new PermissionService();
  });

  describe('hasPermission', () => {
    it('returns true when the role has the permission', () => {
      expect(service.hasPermission(GlobalRole.USER, Permission.SONG_READ)).toBe(
        true,
      );
    });

    it('returns false when the role lacks the permission', () => {
      expect(
        service.hasPermission(GlobalRole.USER, Permission.CONTENT_APPROVE),
      ).toBe(false);
    });

    it('returns true for a permission inherited from a lower tier', () => {
      expect(
        service.hasPermission(GlobalRole.ADMIN, Permission.SONG_READ),
      ).toBe(true);
    });

    it('returns true for SUPER_ADMIN on every permission', () => {
      Object.values(Permission).forEach((permission) => {
        expect(service.hasPermission(GlobalRole.SUPER_ADMIN, permission)).toBe(
          true,
        );
      });
    });
  });

  describe('hasAnyPermission', () => {
    it('returns true if at least one permission matches', () => {
      expect(
        service.hasAnyPermission(GlobalRole.USER, [
          Permission.SONG_CREATE,
          Permission.SONG_READ,
        ]),
      ).toBe(true);
    });

    it('returns false if none match', () => {
      expect(
        service.hasAnyPermission(GlobalRole.USER, [
          Permission.CONTENT_APPROVE,
          Permission.SONG_DELETE,
        ]),
      ).toBe(false);
    });

    it('returns false for an empty permission list', () => {
      expect(service.hasAnyPermission(GlobalRole.SUPER_ADMIN, [])).toBe(false);
    });
  });

  describe('hasAllPermissions', () => {
    it('returns true when every permission matches', () => {
      expect(
        service.hasAllPermissions(GlobalRole.EDITOR, [
          Permission.SONG_READ,
          Permission.SONG_CREATE,
        ]),
      ).toBe(true);
    });

    it('returns false when at least one permission is missing', () => {
      expect(
        service.hasAllPermissions(GlobalRole.EDITOR, [
          Permission.SONG_READ,
          Permission.SONG_DELETE,
        ]),
      ).toBe(false);
    });

    it('returns true for an empty permission list', () => {
      expect(service.hasAllPermissions(GlobalRole.USER, [])).toBe(true);
    });
  });

  describe('getPermissionsForRole', () => {
    it('returns the exact permission list for a role', () => {
      expect(
        [...service.getPermissionsForRole(GlobalRole.USER)].sort(),
      ).toEqual(
        [
          Permission.SONG_READ,
          Permission.SONG_CREATE,
          Permission.SONG_EDIT_OWN,
        ].sort(),
      );
    });

    it('returns every permission for SUPER_ADMIN', () => {
      expect(
        [...service.getPermissionsForRole(GlobalRole.SUPER_ADMIN)].sort(),
      ).toEqual([...Object.values(Permission)].sort());
    });
  });
});
