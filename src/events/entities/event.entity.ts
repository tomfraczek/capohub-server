import {
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Group } from '../../groups/entities/group.entity';
import { User } from '../../users/entities/user.entity';
import { EventStatus } from '../enums/event-status.enum';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';

// Belongs to exactly one Community - an Organization (Root Group) or a
// Group (Child Group), never both, and never moved afterwards (spec: "Nie
// przewidujemy późniejszego przenoszenia Eventu pomiędzy Community" - there
// is deliberately no "move" operation anywhere in this module). Mirrors
// Academy/Section: a plain @ManyToOne(() => Group), no discriminator
// column - "Community" has no entity of its own (ADR-001). Named
// `community` (not `group`, unlike Academy/Section) because the Events
// spec itself uses "Community" as the umbrella term for "Organization or
// Group" throughout - not because this field carries different semantics
// from Academy.group/Section.group.
@Entity({ tableName: 'events' })
@Index({ properties: ['community', 'status'] })
export class Event extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { deleteRule: 'no action' })
  community!: Group;

  // The User who originally created the Event. Always also granted
  // EventRole.OWNER at creation (see EventRolesService.create), but kept
  // here too as immutable provenance independent of the transferable OWNER
  // role - ownership can move (spec: "Owner może przekazać własność"), this
  // cannot. `set null` on delete: a User account can be physically deleted
  // (DELETE /users/me) independently of Events they created in the past
  // (see ADR-007 - the Event itself is never deleted).
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  createdBy: User | null = null;

  @Enum({ items: () => Object.values(EventType) })
  type: EventType = EventType.CUSTOM;

  // Only meaningful when type === CUSTOM; null otherwise (enforced by the
  // create/update schema, not the DB). Free text, not a second enum, since
  // organizer-defined event kinds are inherently open-ended.
  @Property({ nullable: true, length: 100 })
  customTypeLabel: string | null = null;

  @Property({ length: 200 })
  name!: string;

  // Plain text only - no rich text, per spec.
  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Property({ nullable: true, length: 2048 })
  coverImageUrl: string | null = null;

  @Index()
  @Property({ type: 'timestamptz' })
  startsAt!: Date;

  @Index()
  @Property({ type: 'timestamptz' })
  endsAt!: Date;

  // Whether the event spans multiple calendar days is deliberately NOT a
  // stored field - it is always derivable from startsAt/endsAt (see
  // ADR-027: read models are not authoritative) and is computed in
  // event.mapper.ts. "Wielodniowość" itself needs no separate flag: the
  // date range already supports it; storing a redundant boolean would risk
  // drifting from the dates that actually define it.

  // Same address/lat/long shape as Academy (the existing "location" model
  // in this codebase) rather than inventing a second one. All nullable: a
  // Draft event may not have a location decided yet.
  @Property({ nullable: true, type: 'text' })
  locationName: string | null = null;

  @Property({ nullable: true, type: 'text' })
  locationAddress: string | null = null;

  @Property({ nullable: true, type: 'float' })
  latitude: number | null = null;

  @Property({ nullable: true, type: 'float' })
  longitude: number | null = null;

  @Index()
  @Enum({ items: () => Object.values(EventVisibility) })
  visibility: EventVisibility = EventVisibility.COMMUNITY_MEMBERS;

  @Index()
  @Enum({ items: () => Object.values(EventStatus) })
  status: EventStatus = EventStatus.DRAFT;

  // null = no limit (spec: "Limit jest opcjonalny"). A capacity of exactly
  // 0 is rejected by the create/update schema - use no-limit or leave the
  // event in DRAFT instead.
  @Property({ nullable: true, type: 'integer' })
  capacity: number | null = null;

  // Only meaningful when capacity is set; forced back to NONE whenever
  // capacity is cleared (enforced by EventsService.applyFields, not the
  // DB).
  @Enum({ items: () => Object.values(EventWaitlistPolicy) })
  waitlistPolicy: EventWaitlistPolicy = EventWaitlistPolicy.NONE;

  // Stable, immutable, non-guessable locator for sharing/invite links and a
  // future QR poster - the same mechanism as Group.publicCode/
  // User.publicCode (ADR-023 already names "event registration" as an
  // anticipated future use). Not a secret and not an authorization token:
  // resolving it only ever returns this Event's public detail, still
  // gated by the normal visibility rules (see events.service.ts) - unlike
  // the per-user check-in QR code (User.publicCode), which identifies a
  // *person*, this identifies the *Event*.
  @Unique()
  @Property({ nullable: true, length: 15 })
  publicCode: string | null = null;
}
