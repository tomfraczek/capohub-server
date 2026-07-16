import { Injectable } from '@nestjs/common';
import { GlobalRole } from './global-role.enum';
import { Permission } from './permission.enum';
import { ROLE_PERMISSIONS } from './role-permissions.map';

/**
 * Pure lookup over the static ROLE_PERMISSIONS map - no database access.
 * Endpoints are authorized against permissions, not roles directly.
 */
@Injectable()
export class PermissionService {
  hasPermission(role: GlobalRole, permission: Permission): boolean {
    return this.getPermissionsForRole(role).includes(permission);
  }

  hasAnyPermission(role: GlobalRole, permissions: Permission[]): boolean {
    return permissions.some((permission) =>
      this.hasPermission(role, permission),
    );
  }

  hasAllPermissions(role: GlobalRole, permissions: Permission[]): boolean {
    return permissions.every((permission) =>
      this.hasPermission(role, permission),
    );
  }

  getPermissionsForRole(role: GlobalRole): readonly Permission[] {
    return ROLE_PERMISSIONS[role];
  }
}
