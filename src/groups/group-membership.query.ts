import { EntityManager } from '@mikro-orm/postgresql';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupMembership } from './entities/group-membership.entity';

// Shared by GroupPermissionsGuard (on every group-scoped request) and
// GroupsService/GroupMembershipsService (to read the caller's own role, or
// validate a target member). Plain function, not an injectable service, so
// it has no DI/module-boundary overhead for what is effectively a single
// query used from a handful of places within this module.
//
// `group` is always populated (not just its id) - GroupPermissionsGuard
// needs `membership.group.status` to enforce the archived/read-only policy
// (see group-write-policy.ts) without a second round-trip.
export function loadActiveMembership(
  em: EntityManager,
  groupId: string,
  userId: string,
): Promise<GroupMembership | null> {
  return em.findOne(
    GroupMembership,
    {
      group: groupId,
      user: userId,
      status: GroupMembershipStatus.ACTIVE,
    },
    { populate: ['group'] },
  );
}
