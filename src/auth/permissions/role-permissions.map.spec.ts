import { GlobalRole } from './global-role.enum';
import { Permission } from './permission.enum';
import { ROLE_PERMISSIONS } from './role-permissions.map';

const HIERARCHY = [
  GlobalRole.USER,
  GlobalRole.EDITOR,
  GlobalRole.MODERATOR,
  GlobalRole.ADMIN,
  GlobalRole.SUPER_ADMIN,
];

describe('ROLE_PERMISSIONS', () => {
  it('defines a permission list for every GlobalRole', () => {
    Object.values(GlobalRole).forEach((role) => {
      expect(ROLE_PERMISSIONS[role]).toBeDefined();
      expect(Array.isArray(ROLE_PERMISSIONS[role])).toBe(true);
    });
  });

  it('gives SUPER_ADMIN every permission that exists', () => {
    const allPermissions = Object.values(Permission);

    expect([...ROLE_PERMISSIONS[GlobalRole.SUPER_ADMIN]].sort()).toEqual(
      [...allPermissions].sort(),
    );
  });

  it('builds a strict hierarchy: each tier contains everything the tier below it has', () => {
    for (let i = 1; i < HIERARCHY.length; i++) {
      const lower = ROLE_PERMISSIONS[HIERARCHY[i - 1]];
      const higher = ROLE_PERMISSIONS[HIERARCHY[i]];

      lower.forEach((permission) => {
        expect(higher).toContain(permission);
      });
    }
  });

  it('strictly grows at every tier', () => {
    for (let i = 1; i < HIERARCHY.length; i++) {
      expect(ROLE_PERMISSIONS[HIERARCHY[i]].length).toBeGreaterThan(
        ROLE_PERMISSIONS[HIERARCHY[i - 1]].length,
      );
    }
  });

  it('never lists the same permission twice within a role', () => {
    Object.values(GlobalRole).forEach((role) => {
      const permissions = ROLE_PERMISSIONS[role];
      expect(new Set(permissions).size).toBe(permissions.length);
    });
  });

  it('gives USER only read access to songs', () => {
    expect(ROLE_PERMISSIONS[GlobalRole.USER]).toEqual([Permission.SONG_READ]);
  });

  it('gives ADMIN USER_MANAGE', () => {
    expect(ROLE_PERMISSIONS[GlobalRole.ADMIN]).toContain(
      Permission.USER_MANAGE,
    );
  });

  it('reserves APP_SETTINGS_MANAGE for SUPER_ADMIN only', () => {
    expect(ROLE_PERMISSIONS[GlobalRole.ADMIN]).not.toContain(
      Permission.APP_SETTINGS_MANAGE,
    );
    expect(ROLE_PERMISSIONS[GlobalRole.SUPER_ADMIN]).toContain(
      Permission.APP_SETTINGS_MANAGE,
    );
  });

  it('does not give EDITOR moderation or admin permissions', () => {
    const editorPermissions = ROLE_PERMISSIONS[GlobalRole.EDITOR];

    expect(editorPermissions).not.toContain(Permission.CONTENT_APPROVE);
    expect(editorPermissions).not.toContain(Permission.SONG_DELETE);
    expect(editorPermissions).not.toContain(Permission.USER_MANAGE);
  });
});
