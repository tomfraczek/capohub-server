import { randomUUID } from 'node:crypto';
import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  PrimaryKey,
  Property,
} from '@mikro-orm/core';
import { User } from '../../users/entities/user.entity';
import { EventStatus } from '../enums/event-status.enum';
import { Event } from './event.entity';

// Append-only lifecycle log for one Event - spec: "Historia ma zostać
// zachowana" (no deletion, status history preserved). Deliberately its own
// entity, modeled after AuditLogEntry's shape (hand-rolled id/createdAt, no
// updatedAt - an append-only row is never updated afterwards), rather than
// reusing AuditLogEntry/AuditAction/AuditTargetType directly: those are
// Groups-module concepts (ADR-024/ADR-026 - Events must not couple its own
// lifecycle semantics to the Groups aggregate's generic action log). See
// docs/api/events-api.md "Architectural decisions" for the full reasoning.
@Entity({ tableName: 'event_status_history' })
export class EventStatusHistory {
  @PrimaryKey({ type: 'uuid' })
  id: string = randomUUID();

  @Index()
  @ManyToOne(() => Event, { deleteRule: 'no action' })
  event!: Event;

  // Null only for the very first row (creation - DRAFT has no prior
  // status).
  @Enum({ items: () => Object.values(EventStatus), nullable: true })
  fromStatus: EventStatus | null = null;

  @Enum({ items: () => Object.values(EventStatus) })
  toStatus!: EventStatus;

  // Null for the creation row and for a lazily auto-reconciled
  // PUBLISHED -> FINISHED transition (see EventsService.reconcileFinished)
  // - no actor performs that one, it is a passive consequence of `endsAt`
  // passing, exactly like MembershipSuspension's expiry reconciliation.
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  actor: User | null = null;

  // Free text - e.g. the organizer's reason for cancelling.
  @Property({ nullable: true, type: 'text' })
  reason: string | null = null;

  @Index()
  @Property({ type: 'timestamptz', onCreate: () => new Date() })
  createdAt: Date = new Date();
}
