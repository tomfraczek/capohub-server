import { Injectable } from '@nestjs/common';
import { SectionMembershipStatus } from '../enums/section-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupPermission } from './group-permission.enum';
import {
  GROUP_TARGET_ROLE_PERMISSIONS,
  SECTION_TARGET_ROLE_PERMISSIONS,
  READ_ONLY_SAFE_PERMISSIONS,
} from './group-role-permissions.map';

export type PermissionTargetKind = 'GROUP' | 'SECTION';

/**
 * Pure lookup over the static *_TARGET_ROLE_PERMISSIONS maps - no database
 * access. Mirrors PermissionService (auth/permissions/permission.service.ts),
 * but keyed by (target kind, GroupRole) instead of GlobalRole.
 */
@Injectable()
export class GroupPermissionService {
  hasPermission(
    targetKind: PermissionTargetKind,
    role: GroupRole,
    permission: GroupPermission,
  ): boolean {
    return this.getPermissionsForRole(targetKind, role).includes(permission);
  }

  hasAllPermissions(
    targetKind: PermissionTargetKind,
    role: GroupRole,
    permissions: GroupPermission[],
  ): boolean {
    return permissions.every((permission) =>
      this.hasPermission(targetKind, role, permission),
    );
  }

  getPermissionsForRole(
    targetKind: PermissionTargetKind,
    role: GroupRole,
  ): readonly GroupPermission[] {
    const map =
      targetKind === 'GROUP'
        ? GROUP_TARGET_ROLE_PERMISSIONS
        : SECTION_TARGET_ROLE_PERMISSIONS;
    return map[role];
  }

  /**
   * Whether the union of every Role a user holds for a target grants all of
   * `permissions`. `membershipStatus` is `null` for a Group target (Group
   * has no membership - authority is unconditional as long as the
   * RoleAssignment row exists) and the current SectionMembership status for
   * a Section target: ACTIVE grants the full union of every held Role's
   * permissions; READ_ONLY grants only the View-tier subset of that union
   * (see READ_ONLY_SAFE_PERMISSIONS); any other status (INVITED, ARCHIVED)
   * grants nothing. A user may hold several Roles for the same target at
   * once (e.g. MEMBER + INSTRUCTOR + ADMIN) - effective permissions are the
   * union across all of them, never just one.
   */
  hasAllPermissionsForRoles(
    targetKind: PermissionTargetKind,
    roles: GroupRole[],
    permissions: GroupPermission[],
    membershipStatus: SectionMembershipStatus | null,
  ): boolean {
    const effective = this.getEffectivePermissions(
      targetKind,
      roles,
      membershipStatus,
    );
    return permissions.every((permission) => effective.has(permission));
  }

  private getEffectivePermissions(
    targetKind: PermissionTargetKind,
    roles: GroupRole[],
    membershipStatus: SectionMembershipStatus | null,
  ): ReadonlySet<GroupPermission> {
    if (targetKind === 'GROUP') {
      // Group has no membership at all - a held RoleAssignment is
      // unconditionally authoritative.
      const union = new Set<GroupPermission>();
      for (const role of roles) {
        for (const permission of this.getPermissionsForRole(targetKind, role)) {
          union.add(permission);
        }
      }
      return union;
    }

    if (
      membershipStatus === SectionMembershipStatus.INVITED ||
      membershipStatus === SectionMembershipStatus.ARCHIVED ||
      membershipStatus === null
    ) {
      return new Set();
    }

    const union = new Set<GroupPermission>();
    for (const role of roles) {
      for (const permission of this.getPermissionsForRole(targetKind, role)) {
        union.add(permission);
      }
    }

    if (membershipStatus === SectionMembershipStatus.READ_ONLY) {
      return new Set(
        [...union].filter((permission) =>
          READ_ONLY_SAFE_PERMISSIONS.has(permission),
        ),
      );
    }
    return union;
  }
}
