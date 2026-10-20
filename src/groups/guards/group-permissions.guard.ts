import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { ALLOW_GROUP_STATUSES_KEY } from '../decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from '../decorators/require-group-permission.decorator';
import {
  GROUP_KIND_KEY,
  GroupKind,
} from '../decorators/require-group-kind.decorator';
import { assertGroupStatusAllowed } from '../group-write-policy';
import { Community } from '../group-hierarchy.service';
import { Group } from '../entities/group.entity';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupPermission } from '../permissions/group-permission.enum';
import { GroupPermissionService } from '../permissions/group-permission.service';
import {
  GROUP_AUDIENCE_SAFE_PERMISSIONS,
  PUBLIC_VIEW_SAFE_PERMISSIONS,
} from '../permissions/group-role-permissions.map';
import { RoleAssignmentsService } from '../role-assignments.service';

const DEFAULT_ALLOWED_STATUSES: readonly GroupStatus[] = [GroupStatus.ACTIVE];

/**
 * Not global - only runs on routes decorated with
 * @UseGuards(GroupPermissionsGuard) alongside @RequireGroupPermission(...)
 * (see GroupsController/SectionController). Reads the group id from the
 * route's :id param, or :groupId/:sectionId for routes nested under a Group
 * or a Section - the three never collide, since a route only ever has one
 * of the three.
 *
 * Whether the group/section exists at all and whether the caller can see it
 * are the same question here: a user with no usable authorization for it
 * gets 404, never a 403 that would confirm the entity's existence to a
 * non-holder. A 403 is reserved for someone with a Role Assignment for this
 * exact target whose Role lacks the specific permission required.
 *
 * After the permission check passes, this is also the single place that
 * enforces the entity's lifecycle-status policy (see group-write-policy.ts):
 * the handler's @AllowGroupStatuses(...) lists which statuses it may run in
 * (default: ACTIVE only). This applies identically to Group and Section - a
 * Section's own archival is authorization-only (see
 * SectionMembership/RoleAssignment, which archiving never touches): nothing
 * about this check changed for Section, it just now runs against a
 * Section-target authorization the same way it always ran for a Group.
 *
 * Delegates authorization resolution entirely to
 * RoleAssignmentsService.resolveAuthorization(), which branches by target
 * kind: a Group target has no membership at all (a held RoleAssignment is
 * unconditionally authoritative); a Section target additionally requires an
 * active SectionMembership for the same (user, section) - see that
 * method's own comment.
 *
 * When that resolves to nothing (no RoleAssignment/Membership at all) AND
 * every required permission is in PUBLIC_VIEW_SAFE_PERMISSIONS, falls back
 * to RoleAssignmentsService.resolvePublicView() instead of 404ing - lets
 * ANY authenticated user view an `isPublic` Group's (or any Section's)
 * own profile and a Group's list of child Sections (see that set's own comment for exactly
 * which permissions) without holding any Role/Membership, so a community
 * found via Discover search is actually viewable before joining it (see
 * resolvePublicView's own comment for the bug this closes). A private
 * target, or one that doesn't exist, still 404s exactly as before.
 *
 * A user may hold several Role Assignments for the same target at once
 * (e.g. MEMBER + INSTRUCTOR + ADMIN together) - the permission check is the
 * *union* of every held Role's permissions, never just one (see
 * GroupPermissionService.hasAllPermissionsForRoles).
 *
 * A Section membership that is READ_ONLY only grants the View-tier subset
 * of that union (see READ_ONLY_SAFE_PERMISSIONS) - it is never zero
 * authority, nor full authority.
 */
@Injectable()
export class GroupPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      GroupPermission[]
    >(GROUP_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const groupId: unknown =
      request.params.groupId ?? request.params.sectionId ?? request.params.id;

    if (typeof groupId !== 'string' || !uuidSchema.safeParse(groupId).success) {
      throw this.groupNotFound();
    }

    const authorization =
      await this.roleAssignmentsService.resolveAuthorization(
        groupId,
        request.localUser.id,
      );

    let community: Community;

    if (authorization) {
      const { membership, roleAssignments } = authorization;
      const roles = roleAssignments.map((roleAssignment) => roleAssignment.role);
      const targetKind =
        authorization.community instanceof Group ? 'GROUP' : 'SECTION';

      if (
        !this.groupPermissionService.hasAllPermissionsForRoles(
          targetKind,
          roles,
          requiredPermissions,
          membership?.status ?? null,
        )
      ) {
        throw new ForbiddenException({
          code: 'INSUFFICIENT_GROUP_PERMISSIONS',
          message: 'Insufficient permissions in this group',
        });
      }
      community = authorization.community;
    } else {
      // No RoleAssignment/Membership at all - only reachable for a Public
      // Group/Section, and only for the narrow GROUP_VIEW-only tier (see
      // PUBLIC_VIEW_SAFE_PERMISSIONS and resolvePublicView's own comment),
      // or for a Group's own audience reading its announcements (see
      // resolveGroupAudienceView). Anything wider (member list, audit log,
      // ...) still 404s below, same as a genuinely private/nonexistent
      // target.
      const isPublicViewOnly = requiredPermissions.every((permission) =>
        PUBLIC_VIEW_SAFE_PERMISSIONS.has(permission),
      );
      const publicCommunity = isPublicViewOnly
        ? await this.roleAssignmentsService.resolvePublicView(groupId)
        : null;
      const fallbackCommunity =
        publicCommunity ??
        (await this.resolveGroupAudienceView(
          groupId,
          request.localUser.id,
          requiredPermissions,
        ));
      if (!fallbackCommunity) {
        throw this.groupNotFound();
      }
      community = fallbackCommunity;
    }

    const requiredKind = this.reflector.getAllAndOverride<GroupKind>(
      GROUP_KIND_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredKind) {
      // Purely type-based (`instanceof Group`), never a `parentGroup ===
      // null` check: since the Group/Section physical split, a Group with a
      // parent (attached via the hierarchy - see GroupHierarchyService) is
      // still a Group, reachable through GroupsController exactly like a
      // root Group - only its physical table determines its kind, never its
      // position in the hierarchy.
      const isGroupKind = community instanceof Group;
      const matches =
        requiredKind === GroupKind.ROOT ? isGroupKind : !isGroupKind;
      if (!matches) {
        throw this.groupNotFound();
      }
    }

    const allowedStatuses =
      this.reflector.getAllAndOverride<GroupStatus[]>(
        ALLOW_GROUP_STATUSES_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? DEFAULT_ALLOWED_STATUSES;
    assertGroupStatusAllowed(community, allowedStatuses);

    return true;
  }

  /**
   * A Group's audience (formal members + active members of its direct
   * Sections - see RoleAssignmentsService.isGroupAudienceMember) may read
   * its announcements without any Role there. Only for a Group target and
   * only when every required permission is in
   * GROUP_AUDIENCE_SAFE_PERMISSIONS - otherwise null, and the caller 404s
   * exactly as before.
   */
  private async resolveGroupAudienceView(
    groupId: string,
    userId: string,
    requiredPermissions: GroupPermission[],
  ): Promise<Group | null> {
    const isAudienceSafe = requiredPermissions.every((permission) =>
      GROUP_AUDIENCE_SAFE_PERMISSIONS.has(permission),
    );
    return isAudienceSafe
      ? this.roleAssignmentsService.resolveGroupAudienceView(groupId, userId)
      : null;
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
