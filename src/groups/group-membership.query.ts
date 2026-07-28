import { LockMode } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupMembership } from './entities/group-membership.entity';

// Shared by GroupPermissionsGuard (on every group-scoped request) and
// GroupsService/GroupMembershipsService (to read the caller's own role, or
// validate a target member). Plain function, not an injectable service, so
// it has no DI/module-boundary overhead for what is effectively a single
// query used from a handful of places within this module.
//
// `groupId` is intentionally generic, not `rootGroupId`: GroupPermissionsGuard
// checks a caller's Role/Permission directly against whatever Group is being
// acted on (Root or Child - see ADR-013, Role/Permission is never inherited
// through the hierarchy and is a separate concept from Membership), while
// Membership-domain operations (join/leave/remove/cohort-assignment) only
// ever pass a Root Group id, since Membership itself is always Root
// Group-scoped (see organization-entities.md#membership).
//
// `rootGroup` is always populated (not just its id) - GroupPermissionsGuard
// needs `membership.rootGroup.status` to enforce the archived/read-only
// policy (see group-write-policy.ts) without a second round-trip.
//
// `lockMode` is opt-in (PESSIMISTIC_WRITE) for callers that decide whether
// this exact Membership row may be ended or handed OWNER of another Group
// - see GroupMembershipsService.leave/transferOwnership. Locking the row
// serializes against any concurrent decision about the same Membership
// (e.g. a leave() racing a transferOwnership() naming this Membership as
// the new owner), so whichever transaction commits first is the one the
// other observes when it re-reads after the lock is released - never both
// "succeeding" against a state the other has since invalidated.
export function loadActiveMembership(
  em: EntityManager,
  groupId: string,
  userId: string,
  options: { lockMode?: LockMode } = {},
): Promise<GroupMembership | null> {
  return em.findOne(
    GroupMembership,
    {
      rootGroup: groupId,
      user: userId,
      status: GroupMembershipStatus.ACTIVE,
    },
    { populate: ['rootGroup'], ...options },
  );
}
