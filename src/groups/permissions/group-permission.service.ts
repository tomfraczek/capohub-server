import { Injectable } from '@nestjs/common';
import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';
import { GROUP_ROLE_PERMISSIONS } from './group-role-permissions.map';

/**
 * Pure lookup over the static GROUP_ROLE_PERMISSIONS map - no database
 * access. Mirrors PermissionService (auth/permissions/permission.service.ts),
 * but keyed by GroupRole instead of GlobalRole.
 */
@Injectable()
export class GroupPermissionService {
  hasPermission(role: GroupRole, permission: GroupPermission): boolean {
    return this.getPermissionsForRole(role).includes(permission);
  }

  hasAllPermissions(role: GroupRole, permissions: GroupPermission[]): boolean {
    return permissions.every((permission) =>
      this.hasPermission(role, permission),
    );
  }

  getPermissionsForRole(role: GroupRole): readonly GroupPermission[] {
    return GROUP_ROLE_PERMISSIONS[role];
  }
}
