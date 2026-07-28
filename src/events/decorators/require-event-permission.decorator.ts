import { SetMetadata } from '@nestjs/common';
import { EventPermission } from '../permissions/event-permission.enum';

export const EVENT_PERMISSIONS_KEY = 'eventPermissions';

/**
 * Marks a handler as requiring all of the given permissions for the Event
 * identified by the route's :eventId param. Only takes effect where
 * EventPermissionsGuard is also applied via @UseGuards() - mirrors
 * @RequireGroupPermission().
 */
export const RequireEventPermission = (
  ...permissions: EventPermission[]
): ReturnType<typeof SetMetadata> =>
  SetMetadata(EVENT_PERMISSIONS_KEY, permissions);
