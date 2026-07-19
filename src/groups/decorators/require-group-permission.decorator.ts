import { SetMetadata } from '@nestjs/common';
import { GroupPermission } from '../permissions/group-permission.enum';

export const GROUP_PERMISSIONS_KEY = 'groupPermissions';

/**
 * Marks a handler as requiring all of the given permissions in the group
 * identified by the route's :id param. Only takes effect where
 * GroupPermissionsGuard is also applied via @UseGuards() - see
 * GroupsController. Mirrors @Permissions() (auth/decorators/permissions.decorator.ts)
 * but resolved against the caller's GroupMembership.role, not GlobalRole.
 */
export const RequireGroupPermission = (
  ...permissions: GroupPermission[]
): ReturnType<typeof SetMetadata> =>
  SetMetadata(GROUP_PERMISSIONS_KEY, permissions);
