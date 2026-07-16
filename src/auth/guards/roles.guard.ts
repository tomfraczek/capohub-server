import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { GlobalRole } from '../permissions/global-role.enum';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

/**
 * Not global - only runs on routes decorated with @UseGuards(RolesGuard)
 * alongside @Roles(...). Secondary mechanism; prefer PermissionsGuard.
 * Checks membership only (no hierarchy) - hierarchy is PermissionService's job.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<GlobalRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = request.localUser;

    if (!user || !requiredRoles.includes(user.globalRole)) {
      throw new ForbiddenException('Insufficient role');
    }

    return true;
  }
}
