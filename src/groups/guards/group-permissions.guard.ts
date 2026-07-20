import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { uuidSchema } from '../../songs/dto/song-validation.helpers';
import { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import { ALLOW_GROUP_STATUSES_KEY } from '../decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from '../decorators/require-group-permission.decorator';
import { assertGroupStatusAllowed } from '../group-write-policy';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupPermission } from '../permissions/group-permission.enum';
import { GroupPermissionService } from '../permissions/group-permission.service';
import { loadActiveMembership } from '../group-membership.query';

const DEFAULT_ALLOWED_STATUSES: readonly GroupStatus[] = [GroupStatus.ACTIVE];

/**
 * Not global - only runs on routes decorated with
 * @UseGuards(GroupPermissionsGuard) alongside @RequireGroupPermission(...)
 * (see GroupsController). Reads the group id from the route's :id param,
 * or :groupId for routes nested under a Group (e.g.
 * AcademiesController/SectionsController at groups/:groupId/academies) -
 * the two never collide, since a route only ever has one or the other.
 *
 * Whether the group exists at all and whether the caller can see it are the
 * same question here: a user with no active membership gets 404, exactly
 * like PlaylistsService.getById returns 404 for another user's playlist
 * (see playlists.service.ts) - never a 403 that would confirm the group's
 * existence to a non-member. A 403 is reserved for an active member whose
 * role lacks the specific permission required for the action.
 *
 * After the permission check passes, this is also the single place that
 * enforces the group's lifecycle-status policy (see group-write-policy.ts):
 * the handler's @AllowGroupStatuses(...) lists which statuses it may run in
 * (default: ACTIVE only), and any other status rejects the request with 409
 * - so a future write endpoint is blocked by default, not opted in.
 */
@Injectable()
export class GroupPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly groupPermissionService: GroupPermissionService,
    private readonly em: EntityManager,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      GroupPermission[]
    >(GROUP_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const groupId: unknown = request.params.groupId ?? request.params.id;

    if (typeof groupId !== 'string' || !uuidSchema.safeParse(groupId).success) {
      throw this.groupNotFound();
    }

    const membership = await loadActiveMembership(
      this.em,
      groupId,
      request.localUser.id,
    );

    if (!membership) {
      throw this.groupNotFound();
    }

    if (
      !this.groupPermissionService.hasAllPermissions(
        membership.role,
        requiredPermissions,
      )
    ) {
      throw new ForbiddenException({
        code: 'INSUFFICIENT_GROUP_PERMISSIONS',
        message: 'Insufficient permissions in this group',
      });
    }

    const allowedStatuses =
      this.reflector.getAllAndOverride<GroupStatus[]>(
        ALLOW_GROUP_STATUSES_KEY,
        [context.getHandler(), context.getClass()],
      ) ?? DEFAULT_ALLOWED_STATUSES;
    assertGroupStatusAllowed(membership.group, allowedStatuses);

    return true;
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
