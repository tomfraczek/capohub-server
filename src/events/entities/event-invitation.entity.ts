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
import { EventInvitationStatus } from '../enums/event-invitation-status.enum';
import { Event } from './event.entity';

export const EVENT_INVITATIONS_PENDING_USER_IDX =
  'event_invitations_pending_user_unique';
export const EVENT_INVITATIONS_PENDING_EMAIL_IDX =
  'event_invitations_pending_email_unique';

// One row per invitation to a specific Event, for a specific person -
// mirrors MembershipRequest's invited-user/invited-email duality (exactly
// one of the two must be set), but is Event-scoped and one-directional
// (invitation only - Events have no "join request" concept: self-service
// registration is governed by Event.visibility, not by a request that
// needs approval). This is the *registration gate* for INVITE_ONLY Events
// specifically:
//  - visibility = INVITE_ONLY: registering (creating an EventAttendee) for
//    this Event requires an existing, non-terminal invitation for the
//    caller (PENDING or already ACCEPTED - see EventRsvpService.register).
//  - visibility = PUBLIC / COMMUNITY_MEMBERS: an invitation may still be
//    sent (a courtesy nudge) but is never required to register.
//
// Accepting is implicit: the first successful registration transitions a
// PENDING row straight to ACCEPTED (see EventRsvpService.register) - there
// is no separate "accept" endpoint, since accepting-without-registering
// would leave the "Oczekujący" (pending) and "Uczestnicy" UI groups both
// looking wrong at once. Declining IS a separate, explicit endpoint (a
// person may want to say "no" without ever registering).
@Entity({ tableName: 'event_invitations' })
@Unique({
  name: EVENT_INVITATIONS_PENDING_USER_IDX,
  properties: ['event', 'invitedUser'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.event}", "${columns.invitedUser}") where ("${columns.status}" = 'PENDING' and "${columns.invitedUser}" is not null)`,
})
@Unique({
  name: EVENT_INVITATIONS_PENDING_EMAIL_IDX,
  properties: ['event', 'invitedEmail'],
  expression: (table, columns, indexName) =>
    `create unique index "${indexName}" on ${table.toString()} ("${columns.event}", "${columns.invitedEmail}") where ("${columns.status}" = 'PENDING' and "${columns.invitedEmail}" is not null)`,
})
export class EventInvitation extends BaseEntity {
  @Index()
  @ManyToOne(() => Event, { deleteRule: 'no action' })
  event!: Event;

  @Index()
  @ManyToOne(() => User, { deleteRule: 'no action' })
  invitedBy!: User;

  // Set when the invitee already has an account. Exactly one of
  // invitedUser/invitedEmail must be set (enforced by the create schema).
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'no action' })
  invitedUser: User | null = null;

  // Normalized (trimmed + lowercased) email for an invitee with no account
  // yet. Null when invitedUser is set.
  @Index()
  @Property({ nullable: true, length: 255 })
  invitedEmail: string | null = null;

  @Enum({ items: () => Object.values(EventInvitationStatus) })
  status: EventInvitationStatus = EventInvitationStatus.PENDING;

  @Property({ type: 'timestamptz', nullable: true })
  respondedAt: Date | null = null;
}
