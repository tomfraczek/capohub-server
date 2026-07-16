import { SetMetadata } from '@nestjs/common';
import { Permission } from '../permissions/permission.enum';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Marks a handler (or controller) as requiring all of the given permissions.
 * Only takes effect where PermissionsGuard is also applied via @UseGuards() -
 * this is the primary authorization mechanism for the app, ahead of @Roles().
 */
export const Permissions = (
  ...permissions: Permission[]
): ReturnType<typeof SetMetadata> => SetMetadata(PERMISSIONS_KEY, permissions);
