import { Injectable } from '@nestjs/common';
import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';
import {
  GROUP_ROLE_PERMISSIONS,
  READ_ONLY_SAFE_PERMISSIONS,
} from './group-role-permissions.map';

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

  /**
   * Whether the union of every Role a Membership holds for a Group grants
   * all of `permissions`, given the *current status* of that Membership
   * (see organization-entities.md#membership and ADR-028: a Role
   * Assignment's authority is resolved dynamically from Membership status,
   * not stored). A Membership may hold several Roles for the same Group at
   * once (e.g. MEMBER + INSTRUCTOR + ADMIN) - effective permissions are the
   * union across all of them, never just one. ACTIVE grants the full union
   * of every held Role's permissions; READ_ONLY grants only the View-tier
   * subset of that union (see READ_ONLY_SAFE_PERMISSIONS); any other status
   * (INVITED, ARCHIVED) grants nothing.
   */
  hasAllPermissionsForRoles(
    roles: GroupRole[],
    permissions: GroupPermission[],
    membershipStatus: GroupMembershipStatus,
  ): boolean {
    const effective = this.getEffectivePermissions(roles, membershipStatus);
    return permissions.every((permission) => effective.has(permission));
  }

  private getEffectivePermissions(
    roles: GroupRole[],
    membershipStatus: GroupMembershipStatus,
  ): ReadonlySet<GroupPermission> {
    if (membershipStatus === GroupMembershipStatus.INVITED) {
      return new Set();
    }
    if (membershipStatus === GroupMembershipStatus.ARCHIVED) {
      return new Set();
    }

    const union = new Set<GroupPermission>();
    for (const role of roles) {
      for (const permission of this.getPermissionsForRole(role)) {
        union.add(permission);
      }
    }

    if (membershipStatus === GroupMembershipStatus.READ_ONLY) {
      return new Set(
        [...union].filter((permission) =>
          READ_ONLY_SAFE_PERMISSIONS.has(permission),
        ),
      );
    }
    return union;
  }
}
