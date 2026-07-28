import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { User } from '../../users/entities/user.entity';
import { EventAttendeeSubjectType } from '../enums/event-attendee-subject-type.enum';
import { EventCheckInMethod } from '../enums/event-check-in-method.enum';
import { EventRsvpStatus } from '../enums/event-rsvp-status.enum';
import { Event } from './event.entity';

export const EVENT_ATTENDEES_SUBJECT_USER_UNIQUE_INDEX =
  'event_attendees_event_id_subject_user_id_unique';

// One row per person's participation in one Event - the "Uczestnik" of the
// spec. Never deleted: an RSVP of NOT_GOING is still a row (see
// rsvpStatus - spec: "Użytkownik może dowolnie zmieniać decyzję... Dowolną
// liczbę razy"), so a freed capacity seat can be re-claimed later without
// recreating the row, and so "did this person ever register" stays
// answerable.
//
// Represents exactly one of:
//  - the registering User themselves (subjectType = SELF - subjectUser is
//    that same User), or
//  - a child *with their own account* (subjectType = CHILD_ACCOUNT -
//    subjectUser is that other, real User row), or
//  - a child *without* an account (subjectType = CHILD_DEPENDENT -
//    subjectUser is null; dependentDisplayName is free text captured only
//    for this one registration).
// See children-directory.port.ts for why nothing deeper (a reusable
// dependent-profile entity, or verifying a CHILD_ACCOUNT registration
// against a real parent-child relationship) is implemented yet.
//
// `registeredBy` is always the real, authenticated User who performed the
// registration - themselves for a SELF row, the parent/guardian for a
// CHILD_* row. This is who the system holds responsible for *signing this
// person up*, independent of EventGuardianAssignment, which answers a
// different question: who is responsible for this child *at the venue* on
// this specific Event (may be a different person entirely - spec's
// example: one parent bringing several families' children).
@Entity({ tableName: 'event_attendees' })
@Unique({
  name: EVENT_ATTENDEES_SUBJECT_USER_UNIQUE_INDEX,
  properties: ['event', 'subjectUser'],
  // Partial: only constrains SELF/CHILD_ACCOUNT rows (subjectUser set).
  // CHILD_DEPENDENT rows (subjectUser null) have no stable identity to
  // dedupe against - see the entity comment above.
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.event}", "${columns.subjectUser}") where ("${columns.subjectUser}" is not null)`,
})
export class EventAttendee extends BaseEntity {
  @Index()
  @ManyToOne(() => Event, { deleteRule: 'no action' })
  event!: Event;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  registeredBy!: User;

  @Enum({ items: () => Object.values(EventAttendeeSubjectType) })
  subjectType!: EventAttendeeSubjectType;

  // Set for SELF and CHILD_ACCOUNT; null for CHILD_DEPENDENT.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'no action' })
  subjectUser: User | null = null;

  // Set only for CHILD_DEPENDENT - see the entity comment above. Not a FK:
  // no reusable dependent-profile entity exists yet.
  @Property({ nullable: true, length: 150 })
  dependentDisplayName: string | null = null;

  @Enum({ items: () => Object.values(EventRsvpStatus) })
  rsvpStatus: EventRsvpStatus = EventRsvpStatus.GOING;

  @Property({ type: 'timestamptz' })
  registeredAt: Date = new Date();

  // ─── Capacity / waitlist bookkeeping (see EventWaitlistPolicy) ─────────
  // `isWaitlisted` is the current, authoritative state. `waitlistedAt` is
  // when this row most recently entered the waitlist - AUTOMATIC promotion
  // always promotes the earliest `waitlistedAt` first (FIFO). `promotedAt`
  // records when it left the waitlist, if ever, and is kept as history
  // (never cleared back to null) rather than derived, since a row can be
  // waitlisted, promoted, and (if it later frees its own seat) waitlisted
  // again - only the *current* `isWaitlisted`/`waitlistedAt` pair reflects
  // the live state at any point.
  @Property()
  isWaitlisted: boolean = false;

  @Property({ type: 'timestamptz', nullable: true })
  waitlistedAt: Date | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  promotedAt: Date | null = null;

  // ─── Check-in ───────────────────────────────────────────────────────────
  // Deliberately flat fields, not a separate entity: each attendee has
  // exactly one current presence status, never a history of scans (spec:
  // "Każda osoba posiada własny status obecności"). A future payment-
  // verification gate slots into EventCheckInService.checkIn() as an extra
  // precondition before these fields are set - no schema change needed for
  // that (see events-api.md "Check-in extensibility").
  @Property()
  checkedIn: boolean = false;

  @Property({ type: 'timestamptz', nullable: true })
  checkedInAt: Date | null = null;

  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  checkedInBy: User | null = null;

  @Enum({ items: () => Object.values(EventCheckInMethod), nullable: true })
  checkInMethod: EventCheckInMethod | null = null;
}
