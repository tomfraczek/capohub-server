import { Injectable } from '@nestjs/common';
import { EventRole } from '../enums/event-role.enum';
import { EventPermission } from './event-permission.enum';
import { EVENT_ROLE_PERMISSIONS } from './event-role-permissions.map';

/**
 * Pure lookup over the static EVENT_ROLE_PERMISSIONS map - no database
 * access. Mirrors GroupPermissionService, but keyed by EventRole instead of
 * GroupRole, and with no membership-status-based downgrade: unlike a
 * GroupRole (whose authority depends on the holder's live Membership
 * status - ACTIVE/READ_ONLY/...), an EventRoleAssignment's authority is not
 * resolved against anything else - see event-role-assignment.entity.ts.
 */
@Injectable()
export class EventPermissionService {
  hasPermission(role: EventRole, permission: EventPermission): boolean {
    return this.getPermissionsForRole(role).includes(permission);
  }

  getPermissionsForRole(role: EventRole): readonly EventPermission[] {
    return EVENT_ROLE_PERMISSIONS[role];
  }

  /**
   * Whether the union of every Role a user holds for an Event grants all of
   * `permissions`. A user may hold more than one Role for the same Event at
   * once (mirrors RoleAssignment/GroupRole) - effective permissions are
   * always the union across all of them, never just one.
   */
  hasAllPermissionsForRoles(
    roles: EventRole[],
    permissions: EventPermission[],
  ): boolean {
    const effective = new Set<EventPermission>();
    for (const role of roles) {
      for (const permission of this.getPermissionsForRole(role)) {
        effective.add(permission);
      }
    }
    return permissions.every((permission) => effective.has(permission));
  }
}
