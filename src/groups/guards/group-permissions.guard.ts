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

    if (!authorization) {
      throw this.groupNotFound();
    }

    const { community, membership, roleAssignments } = authorization;
    const roles = roleAssignments.map((roleAssignment) => roleAssignment.role);
    const targetKind = community instanceof Group ? 'GROUP' : 'SECTION';

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

    const requiredKind = this.reflector.getAllAndOverride<GroupKind>(
      GROUP_KIND_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredKind) {
      // Type-based, not a `parentGroup === null` check: a Section is never
      // a ROOT kind regardless of whether it currently has a parent.
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
