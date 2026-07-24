import { ConflictException } from '@nestjs/common';
import { Group } from './entities/group.entity';
import { GroupStatus } from './enums/group-status.enum';

// One conflict per status, keyed by the group's *current* status - not by
// which action was attempted. This is what lets a single generic check
// (assertGroupStatusAllowed) cover every endpoint: whatever action is
// blocked, the reason is always "the group is currently in status X", and
// that message only depends on X.
const STATUS_CONFLICTS: Readonly<
  Partial<Record<GroupStatus, { code: string; message: string }>>
> = {
  [GroupStatus.ACTIVE]: {
    code: 'GROUP_ACTIVE',
    message: 'This action is not available while the group is active',
  },
  [GroupStatus.READ_ONLY]: {
    code: 'GROUP_READ_ONLY',
    message: 'This group is read-only',
  },
  [GroupStatus.ARCHIVED]: {
    code: 'GROUP_ARCHIVED',
    message: 'This group is archived and is read-only until it is restored',
  },
  [GroupStatus.DELETED]: {
    code: 'GROUP_DELETED',
    message: 'This group has been permanently deleted',
  },
};

/**
 * Central lifecycle-status guard: call this anywhere a Group's current
 * status must be checked before an action is allowed, instead of repeating
 * `if (group.status === ...)` per method. GroupPermissionsGuard calls this
 * for every @RequireGroupPermission(...) handler, using the statuses listed
 * in that handler's @AllowGroupStatuses(...) (default: ACTIVE only - see
 * decorators/allow-group-statuses.decorator.ts). Future group-scoped modules
 * (sections, trainings, announcements, events, dues) can import and call
 * this same function once they've loaded their own parent Group, so "is this
 * group in a status that allows this action" is answered in exactly one
 * place project-wide.
 */
export function assertGroupStatusAllowed(
  group: Pick<Group, 'status'>,
  allowedStatuses: readonly GroupStatus[],
): void {
  if (allowedStatuses.includes(group.status)) {
    return;
  }

  throw new ConflictException(
    STATUS_CONFLICTS[group.status] ?? {
      code: 'GROUP_STATUS_NOT_ALLOWED',
      message: "This action is not available in the group's current status",
    },
  );
}

/**
 * Convenience wrapper for the common case: an ordinary write action that
 * only ever makes sense while the group is fully ACTIVE (edit, add/remove/
 * re-role a member, leave, transfer ownership, and - for future modules -
 * anything section/training/announcement/event/due related). Lifecycle
 * actions that legitimately run from more than one status (archive,
 * unarchive, read-only, activate) use assertGroupStatusAllowed directly with
 * their own explicit allow-list instead - see GroupPermissionsGuard.
 */
export function assertGroupIsWritable(group: Pick<Group, 'status'>): void {
  assertGroupStatusAllowed(group, [GroupStatus.ACTIVE]);
}
