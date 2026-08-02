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
import { Group } from '../entities/group.entity';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupPermission } from '../permissions/group-permission.enum';
import { GroupPermissionService } from '../permissions/group-permission.service';
import { RoleAssignmentsService } from '../role-assignments.service';

const DEFAULT_ALLOWED_STATUSES: readonly GroupStatus[] = [GroupStatus.ACTIVE];

/**
 * Not global - only runs on routes decorated with
 * @UseGuards(GroupPermissionsGuard) alongside @RequireGroupPermission(...)
 * (see GroupsController). Reads the group id from the route's :id param, or
 * :groupId/:sectionId for routes nested under a Group or a Section (e.g.
 * AcademiesController/CohortsController at groups/:groupId/academies, dual-
 * mounted at sections/:sectionId/academies) - the three never collide,
 * since a route only ever has one of the three.
 *
 * Whether the group exists at all and whether the caller can see it are the
 * same question here: a user with no usable authorization for it gets 404,
 * exactly like PlaylistsService.getById returns 404 for another user's
 * playlist (see playlists.service.ts) - never a 403 that would confirm the
 * group's existence to a non-member. A 403 is reserved for someone with a
 * Role Assignment for this exact Group whose Role lacks the specific
 * permission required for the action.
 *
 * After the permission check passes, this is also the single place that
 * enforces the group's lifecycle-status policy (see group-write-policy.ts):
 * the handler's @AllowGroupStatuses(...) lists which statuses it may run in
 * (default: ACTIVE only), and any other status rejects the request with 409
 * - so a future write endpoint is blocked by default, not opted in.
 *
 * Delegates authorization resolution entirely to
 * RoleAssignmentsService.resolveAuthorization(), which:
 * 1. resolves the acted-on Group's Root Group,
 * 2. finds the caller's Membership there (must be ACTIVE or READ_ONLY),
 * 3. finds *every* Role Assignment the caller holds for the exact acted-on
 *    Group - never a Root Group fallback, never inherited from a parent, a
 *    Child, or a sibling Group (see ADR-013, ADR-028).
 *
 * A Membership may hold several Role Assignments for the same Group at
 * once (e.g. MEMBER + INSTRUCTOR + ADMIN together) - the permission check
 * is the *union* of every held Role's permissions, never just one (see
 * GroupPermissionService.hasAllPermissionsForRoles).
 *
 * A Membership that is READ_ONLY only grants the View-tier subset of that
 * union (see READ_ONLY_SAFE_PERMISSIONS) - "remains visible... but the
 * user loses operational permissions" (see
 * organization-entities.md#membership).
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

    if (!authorization) {
      throw this.groupNotFound();
    }

    const { community, membership, roleAssignments } = authorization;
    const roles = roleAssignments.map((roleAssignment) => roleAssignment.role);

    if (
      !this.groupPermissionService.hasAllPermissionsForRoles(
        roles,
        requiredPermissions,
        membership.status,
      )
    ) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_GROUP_PERMISSIONS',
        message: 'Insufficient permissions in this group',
      });
    }

    const requiredKind = this.reflector.getAllAndOverride<GroupKind>(
      GROUP_KIND_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredKind) {
      // Type-based, not a `parentGroup === null` check: a Section is never
      // a ROOT kind regardless of whether it currently has a parent (see
      // the organizational-domain rebuild, stage 1 - `parentGroupId` is no
      // longer how a row's type is recognized).
      const isRoot =
        community instanceof Group && community.parentGroup === null;
      const matches = requiredKind === GroupKind.ROOT ? isRoot : !isRoot;
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

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
