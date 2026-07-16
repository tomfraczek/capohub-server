import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { Permission } from '../permissions/permission.enum';
import { PermissionService } from '../permissions/permission.service';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

/**
 * Not global - only runs on routes decorated with @UseGuards(PermissionsGuard)
 * alongside @Permissions(...). Requires request.localUser, so it must run
 * after the (global) ClerkAuthGuard has synced the user onto the request.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly permissionService: PermissionService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredPermissions = this.reflector.getAllAndOverride<Permission[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.localUser;

    if (
      !user ||
      !this.permissionService.hasAllPermissions(
        user.globalRole,
        requiredPermissions,
      )
    ) {
      throw new ForbiddenException('Insufficient permissions');
    }

    return true;
  }
}
