import { Entity, Index, ManyToOne, Property, Unique } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { EventAttendee } from './event-attendee.entity';
import { Event } from './event.entity';

export const EVENT_GUARDIAN_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX =
  'event_guardian_assignments_attendee_id_active_unique';

// "Opiekun wydarzenia" - deliberately separate from the (not-yet-built)
// global parent -> child relationship (see children-directory.port.ts).
// This relationship is scoped to exactly one Event and one specific child
// attendee row, so one parent can delegate pickup/drop-off/on-site
// responsibility for their child(ren) to a different adult for a single
// event (spec's example: one parent bringing several families' children),
// without that adult needing any standing relationship to the child at
// all - only to this Event.
//
// `guardian` must be a real User (spec: "musi być użytkownikiem aplikacji")
// - never a name-only stand-in like EventAttendee.dependentDisplayName.
// `guardian` does NOT need their own EventAttendee row (spec: an
// Organizer/guardian need not be a participant) - there is deliberately no
// FK/check tying this to EventAttendee for the guardian side, only for the
// child side (`attendee`, which must itself be a CHILD_ACCOUNT or
// CHILD_DEPENDENT row - enforced in EventGuardiansService, not the DB,
// since MikroORM/Postgres CHECK constraints here cannot cheaply reach
// across to another table's column).
//
// Exactly one *active* guardian per child per Event (spec: "jedno dziecko
// może mieć tylko jednego aktywnego opiekuna na danym Evencie") - enforced
// by the partial unique index below, the same technique as
// MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX. Reassigning a child's
// guardian revokes (sets revokedAt) the previous row and inserts a new one
// in the same transaction - never updates the old row's `guardian` in
// place, so the assignment history is preserved.
@Entity({ tableName: 'event_guardian_assignments' })
@Unique({
  name: EVENT_GUARDIAN_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  properties: ['attendee'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.attendee}") where ("${columns.revokedAt}" is null)`,
})
export class EventGuardianAssignment extends BaseEntity {
  @Index()
  @ManyToOne(() => Event, { deleteRule: 'no action' })
  event!: Event;

  // The child's own EventAttendee row for this Event - never the
  // guardian's.
  @Index()
  @ManyToOne(() => EventAttendee, { deleteRule: 'no action' })
  attendee!: EventAttendee;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  guardian!: User;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  assignedBy!: User;

  @Property({ type: 'timestamptz' })
  assignedAt: Date = new Date();

  @Property({ type: 'timestamptz', nullable: true })
  revokedAt: Date | null = null;
}
