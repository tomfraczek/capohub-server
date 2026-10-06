import { ConflictException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import type { Event } from '../events/entities/event.entity';
import { Group } from '../groups/entities/group.entity';
import { User } from '../users/entities/user.entity';
import { CustomUserRank } from './entities/custom-user-rank.entity';
import {
  FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  FormalRankAssignment,
} from './entities/formal-rank-assignment.entity';
import { FormalRankRequest } from './entities/formal-rank-request.entity';
import { Rank } from './entities/rank.entity';
import { FormalRankRequestStatus } from './enums/formal-rank-request-status.enum';

// The few writes that move a user's *current* rank, shared by every path
// that does it (immediate self-confirmation by a Group OWNER/ADMIN, an
// approved FormalRankRequest, setting an independent rank) - so "a user has
// at most one active rank, formal or independent, and a replaced one is
// ended, never deleted" is enforced in exactly one place.

export function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

// A stint is never ended before it started (formal_rank_assignments has a
// CHECK for exactly that) - a startedOn of today ends today.
function endedOnFor(startedOn: Date | string | null): Date {
  const today = startOfTodayUtc();
  if (!startedOn) {
    return today;
  }
  const started =
    typeof startedOn === 'string'
      ? new Date(`${startedOn}T00:00:00.000Z`)
      : startedOn;
  return started.getTime() > today.getTime() ? started : today;
}

export async function endActiveFormalRank(
  em: EntityManager,
  userId: string,
): Promise<void> {
  const current = await em.findOne(FormalRankAssignment, {
    user: userId,
    endedOn: null,
  });
  if (current) {
    current.endedOn = endedOnFor(current.startedOn);
    // Flushed on its own before any insert - MikroORM applies inserts
    // before updates within a single flush (see
    // FormalGroupAffiliation's switch for the same ordering).
    await em.flush();
  }
}

export async function endActiveIndependentRank(
  em: EntityManager,
  userId: string,
): Promise<void> {
  const current = await em.findOne(CustomUserRank, {
    user: userId,
    endedOn: null,
  });
  if (current) {
    current.endedOn = endedOnFor(current.startedOn);
    await em.flush();
  }
}

/**
 * Makes `rank` (from `group`'s catalog) the user's current, confirmed rank:
 * ends whatever rank was current (formal or independent - both stay as
 * history) and inserts the new FormalRankAssignment.
 */
export async function assignFormalRank(
  em: EntityManager,
  input: {
    user: User;
    rank: Rank;
    group: Group;
    startedOn: Date | null;
    awardedByName: string | null;
    event: Event | null;
  },
): Promise<FormalRankAssignment> {
  await endActiveFormalRank(em, input.user.id);
  await endActiveIndependentRank(em, input.user.id);

  const assignment = new FormalRankAssignment();
  assignment.user = input.user;
  assignment.rank = input.rank;
  assignment.sourceGroup = input.group;
  assignment.startedOn = input.startedOn;
  assignment.awardedByName = input.awardedByName;
  assignment.event = input.event;

  try {
    em.persist(assignment);
    await em.flush();
  } catch (error) {
    if (
      isUniqueViolationOn(error, FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX)
    ) {
      throw new ConflictException({
        code: 'RANK_ALREADY_SET',
        message: 'A concurrent change already set an active formal rank',
      });
    }
    throw error;
  }
  return assignment;
}

/**
 * CANCELLED (never deleted) - a pending rank request only makes sense
 * against the user's *current* formal Group, so it is cancelled when that
 * Group changes or ends, and superseded by a newer request. `keepGroupId`
 * keeps one targeting that Group (e.g. a formal Group re-set to itself).
 */
export async function cancelPendingFormalRankRequests(
  em: EntityManager,
  userId: string,
  keepGroupId: string | null = null,
): Promise<void> {
  const pending = await em.find(FormalRankRequest, {
    user: userId,
    status: FormalRankRequestStatus.PENDING,
    ...(keepGroupId ? { group: { $ne: keepGroupId } } : {}),
  });
  if (pending.length === 0) {
    return;
  }
  const now = new Date();
  for (const request of pending) {
    request.status = FormalRankRequestStatus.CANCELLED;
    request.decidedAt = now;
  }
  await em.flush();
}
