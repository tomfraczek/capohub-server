import { ConflictException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import {
  FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX,
  FormalGroupAffiliation,
} from './entities/formal-group-affiliation.entity';
import { Group } from './entities/group.entity';
import { MembershipRequest } from './entities/membership-request.entity';
import { MembershipRequestStatus } from './enums/membership-request-status.enum';
import { MembershipRequestTarget } from './enums/membership-request-target.enum';
import { MembershipRequestType } from './enums/membership-request-type.enum';
import { assertNotLeavingOwnedGroup } from './owner-formal-group';

export function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

/**
 * The one place a FormalGroupAffiliation is switched to `group` - shared by
 * the immediate path (UserProfileService.setFormalGroup) and an approved
 * Group join request (MembershipRequestsService.approveJoinRequest), so both
 * end the current affiliation and insert the new one the exact same way,
 * inside the caller's transaction. Re-checks the OWNER invariant (see
 * owner-formal-group.ts) - an approval can run long after the request was
 * sent. Re-setting the same Group only updates startedOn (when given).
 */
export async function switchFormalGroup(
  em: EntityManager,
  user: User,
  group: Group,
  startedOn: Date | null,
): Promise<FormalGroupAffiliation> {
  const current = await em.findOne(
    FormalGroupAffiliation,
    { user: user.id, endedOn: null },
    { populate: ['group'] },
  );

  await assertNotLeavingOwnedGroup(
    em,
    user.id,
    current?.group.id ?? null,
    group.id,
  );

  if (current && current.group.id === group.id) {
    if (startedOn) {
      current.startedOn = startedOn;
      await em.flush();
    }
    return current;
  }

  if (current) {
    current.endedOn = startOfTodayUtc();
    // Flushed before the new row is inserted below - MikroORM's
    // UnitOfWork applies inserts before updates within a single flush,
    // which would otherwise insert the new active row while the
    // previous one is still active, transiently violating
    // FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX (same reasoning as
    // RoleAssignmentsService.transferOwnership's revoke-before-insert
    // ordering).
    await em.flush();
  }

  const affiliation = new FormalGroupAffiliation();
  affiliation.user = user;
  affiliation.group = group;
  affiliation.startedOn = startedOn;

  try {
    em.persist(affiliation);
    await em.flush();
  } catch (error) {
    // Race backstop - see the equivalent comment in
    // SectionMembershipsService.addMember().
    if (
      isUniqueViolationOn(error, FORMAL_GROUP_AFFILIATIONS_ACTIVE_UNIQUE_INDEX)
    ) {
      throw new ConflictException({
        code: 'FORMAL_GROUP_ALREADY_SET',
        message: 'A concurrent change already set an active formal group',
      });
    }
    throw error;
  }

  return affiliation;
}

/**
 * A user has at most one formal Group, so at most one Group join request
 * is ever meaningful at a time: sending a new one, setting a formal Group
 * directly, or having one approved makes every other PENDING one moot. They
 * are CANCELLED (never deleted - history is kept), processedBy the user
 * themselves, same as an explicit withdrawal.
 */
export async function cancelPendingGroupJoinRequests(
  em: EntityManager,
  user: User,
  exceptRequestId: string | null,
): Promise<void> {
  const pending = await em.find(MembershipRequest, {
    initiatedBy: user.id,
    type: MembershipRequestType.JOIN_REQUEST,
    targetType: MembershipRequestTarget.GROUP,
    status: MembershipRequestStatus.PENDING,
    ...(exceptRequestId ? { id: { $ne: exceptRequestId } } : {}),
  });
  if (pending.length === 0) {
    return;
  }
  const now = new Date();
  for (const request of pending) {
    request.status = MembershipRequestStatus.CANCELLED;
    request.processedAt = now;
    request.processedBy = user;
  }
  await em.flush();
}
