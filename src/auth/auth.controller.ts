import { Controller, Get, UseGuards } from '@nestjs/common';
import { CurrentAuth } from './decorators/current-auth.decorator';
import { CurrentUser } from './decorators/current-user.decorator';
import { Permissions } from './decorators/permissions.decorator';
import { PermissionsGuard } from './guards/permissions.guard';
import { Permission } from './permissions/permission.enum';
import type { AuthContext } from './types/auth-context.type';
import type { GlobalRole } from './permissions/global-role.enum';
import type { User } from '../users/entities/user.entity';

interface SessionResponse {
  authenticated: true;
  userId: string;
  sessionId: string;
}

interface PermissionsTestResponse {
  ok: true;
  globalRole: GlobalRole;
}

@Controller('auth')
export class AuthController {
  @Get('session')
  getSession(@CurrentAuth() auth: AuthContext): SessionResponse {
    return {
      authenticated: true,
      userId: auth.userId,
      sessionId: auth.sessionId,
    };
  }

  // Test-only: exercises PermissionsGuard end to end. Not used by the
  // frontend.
  @Get('permissions-test')
  @UseGuards(PermissionsGuard)
  @Permissions(Permission.USER_MANAGE)
  getPermissionsTest(@CurrentUser() user: User): PermissionsTestResponse {
    return { ok: true, globalRole: user.globalRole };
  }
}
