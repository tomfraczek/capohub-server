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
import { GroupPermission } from '../../groups/permissions/group-permission.enum';
import { GroupPermissionService } from '../../groups/permissions/group-permission.service';
import { RoleAssignmentsService } from '../../groups/role-assignments.service';
import { EVENT_PERMISSIONS_KEY } from '../decorators/require-event-permission.decorator';
import { eventCommunity } from '../event-community.util';
import { EventRolesService } from '../event-roles.service';
import { EventPermission } from '../permissions/event-permission.enum';
import { EventPermissionService } from '../permissions/event-permission.service';

// Permissions a Community ADMIN/OWNER's GroupPermission.EVENT_MODERATE may
// satisfy even without holding any Event role - deliberately narrow (see
// GroupPermission.EVENT_MODERATE's own comment: cancel only, never edit or
// organizer/moderator management).
const COMMUNITY_OVERRIDABLE_PERMISSIONS: ReadonlySet<EventPermission> = new Set(
  [EventPermission.EVENT_CANCEL],
);

/**
 * Not global - only runs on routes decorated with
 * @UseGuards(EventPermissionsGuard) alongside @RequireEventPermission(...).
 * Reads the Event id from the route's :eventId (or :id) param. Mirrors
 * GroupPermissionsGuard's 404-vs-403 split: a caller with no relationship
 * to this Event at all (no Event role, and no qualifying Community
 * oversight override) gets 404 - never a 403 that would confirm the
 * Event's existence to a stranger. A 403 is reserved for someone who holds
 * at least one Event role but not the specific permission required.
 */
@Injectable()
export class EventPermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly eventPermissionService: EventPermissionService,
    private readonly eventRolesService: EventRolesService,
    private readonly roleAssignmentsService: RoleAssignmentsService,
    private readonly groupPermissionService: GroupPermissionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<
      EventPermission[]
    >(EVENT_PERMISSIONS_KEY, [context.getHandler(), context.getClass()]);

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const eventId: unknown = request.params.eventId ?? request.params.id;

    if (typeof eventId !== 'string' || !uuidSchema.safeParse(eventId).success) {
      throw this.eventNotFound();
    }

    const { event, roles } = await this.eventRolesService.resolveAuthorization(
      eventId,
      request.localUser.id,
    );

    if (
      this.eventPermissionService.hasAllPermissionsForRoles(
        roles,
        requiredPermissions,
      )
    ) {
      return true;
    }

    const overridable = requiredPermissions.every((permission) =>
      COMMUNITY_OVERRIDABLE_PERMISSIONS.has(permission),
    );
    if (overridable) {
      const communityAuthorization =
        await this.roleAssignmentsService.resolveAuthorization(
          eventCommunity(event).id,
          request.localUser.id,
        );
      if (communityAuthorization) {
        const communityRoles = communityAuthorization.roleAssignments.map(
          (assignment) => assignment.role,
        );
        const hasOverride =
          this.groupPermissionService.hasAllPermissionsForRoles(
            communityRoles,
            [GroupPermission.EVENT_MODERATE],
            communityAuthorization.membership.status,
          );
        if (hasOverride) {
          return true;
        }
      }
    }

    if (roles.length === 0) {
      throw this.eventNotFound();
    }

    throw new ForbiddenException({
      code: 'INSUFFICIENT_EVENT_PERMISSIONS',
      message: 'Insufficient permissions for this event',
    });
  }

  private eventNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'EVENT_NOT_FOUND',
      message: 'Event not found',
    });
  }
}
