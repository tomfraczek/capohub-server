import { SetMetadata } from '@nestjs/common';
import { GlobalRole } from '../permissions/global-role.enum';

export const ROLES_KEY = 'roles';

/**
 * Marks a handler (or controller) as requiring one of the given global
 * roles. Only takes effect where RolesGuard is also applied via @UseGuards().
 * Secondary mechanism - prefer @Permissions() for endpoint authorization.
 */
export const Roles = (...roles: GlobalRole[]): ReturnType<typeof SetMetadata> =>
  SetMetadata(ROLES_KEY, roles);
