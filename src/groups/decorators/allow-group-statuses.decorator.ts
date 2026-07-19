import { SetMetadata } from '@nestjs/common';
import { GroupStatus } from '../enums/group-status.enum';

export const ALLOW_GROUP_STATUSES_KEY = 'allowGroupStatuses';

/**
 * Lists the Group statuses a @RequireGroupPermission(...) handler may run
 * in. GroupPermissionsGuard defaults to ACTIVE-only when this decorator is
 * absent - fail-closed, so a future write endpoint added without it is
 * blocked on READ_ONLY/ARCHIVED groups automatically, never silently left
 * open (see group-write-policy.ts). Reads (GET .../:id, GET .../:id/members)
 * list every status; the four lifecycle endpoints
 * (archive/unarchive/read-only/activate) each list exactly the statuses
 * they're valid from - see GroupsController.
 */
export const AllowGroupStatuses = (
  ...statuses: GroupStatus[]
): ReturnType<typeof SetMetadata> =>
  SetMetadata(ALLOW_GROUP_STATUSES_KEY, statuses);
