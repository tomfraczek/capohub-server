import { ConflictException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { Event } from './entities/event.entity';
import { EventStatusHistory } from './entities/event-status-history.entity';
import { EventStatus } from './enums/event-status.enum';

// Event's own lifecycle status is a business object concept, not a Group
// concept (mirrors Academy/Cohort's own `status` field, asserted inline
// in their services - not GroupStatus, which is enforced centrally by
// GroupPermissionsGuard/AllowGroupStatuses). Every Event write action
// calls this directly against the Event's *current* status, keyed the same
// way group-write-policy.ts keys its conflicts.
const STATUS_CONFLICTS: Readonly<
  Partial<Record<EventStatus, { code: string; message: string }>>
> = {
  [EventStatus.DRAFT]: {
    code: 'EVENT_DRAFT',
    message: 'This action is not available while the event is a draft',
  },
  [EventStatus.PUBLISHED]: {
    code: 'EVENT_PUBLISHED',
    message: 'This action is not available while the event is published',
  },
  [EventStatus.CANCELLED]: {
    code: 'EVENT_CANCELLED',
    message: 'This event has been cancelled',
  },
  [EventStatus.FINISHED]: {
    code: 'EVENT_FINISHED',
    message: 'This event has already finished',
  },
};

export function assertEventStatusAllowed(
  event: Pick<Event, 'status'>,
  allowedStatuses: readonly EventStatus[],
): void {
  if (allowedStatuses.includes(event.status)) {
    return;
  }

  throw new ConflictException(
    STATUS_CONFLICTS[event.status] ?? {
      code: 'EVENT_STATUS_NOT_ALLOWED',
      message: "This action is not available in the event's current status",
    },
  );
}

// Shared allow-list for every "administrative" action on an Event: editing
// its own fields, granting/revoking/transferring its Owner/Organizer/
// Moderator roles, managing invitations, managing guardian assignments,
// and manually promoting from the waitlist. All of these are valid while
// the Event is still being organized (DRAFT) or is live (PUBLISHED), and
// are blocked once it is over, one way or another (FINISHED, CANCELLED) -
// see docs/api/events-api.md "Event lifecycle status". Centralized here,
// rather than repeated as an inline array per call site, so every one of
// these operations is guaranteed to agree on exactly the same rule.
export const ADMIN_OPERATION_STATUSES: readonly EventStatus[] = [
  EventStatus.DRAFT,
  EventStatus.PUBLISHED,
];

/**
 * Lazily reconciles a PUBLISHED Event whose `endsAt` has passed to
 * FINISHED - this codebase has no scheduler/cron infrastructure, so
 * instead of a background job flipping `status` the moment an Event ends,
 * the next time it is loaded by anyone (EventAccessService.loadOrFail),
 * an `endsAt` in the past is detected and reconciled right here, before
 * any permission/status check that follows runs. Mirrors
 * RoleAssignmentsService.reconcileExpiredSuspension. Not attributed to any
 * actor (no one performed it - it is a passive consequence of time
 * passing), same reasoning as that suspension-expiry reconciliation.
 *
 * A no-op for every other status, and for a PUBLISHED Event whose `endsAt`
 * has not yet passed.
 */
export async function reconcileEventFinished(
  em: EntityManager,
  event: Event,
): Promise<void> {
  if (event.status !== EventStatus.PUBLISHED) {
    return;
  }
  if (event.endsAt.getTime() > Date.now()) {
    return;
  }

  const history = new EventStatusHistory();
  history.event = event;
  history.fromStatus = event.status;
  history.toStatus = EventStatus.FINISHED;
  history.actor = null;
  history.reason = null;

  event.status = EventStatus.FINISHED;
  await em.persist(history).flush();
}
