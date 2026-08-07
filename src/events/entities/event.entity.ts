import {
  Check,
  Entity,
  Enum,
  Index,
  ManyToOne,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Group } from '../../groups/entities/group.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import { EventStatus } from '../enums/event-status.enum';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';

export const EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX =
  'events_type_numeric_code_unique';

// Belongs to exactly one Community - a Group or a Section, never both, and
// never moved afterwards (spec: "Nie przewidujemy późniejszego
// przenoszenia Eventu pomiędzy Community" - there is deliberately no
// "move" operation anywhere in this module). Represented by two nullable
// FKs (exactly one set) since the Group/Section physical split - see
// GroupHierarchyService.findCommunityById for resolving whichever one is
// populated.
@Entity({ tableName: 'events' })
@Index({ properties: ['communityGroup', 'status'] })
@Index({ properties: ['communitySection', 'status'] })
// Exactly one of `communityGroup`/`communitySection` must be set, never
// both, never neither - mirrored here so migration:create/schema:update
// know this constraint is intentional and never propose dropping it. Name
// matches the constraint the migration creates verbatim - see
// Migration20260802100200_AddPolymorphicCommunityReferences.
@Check<Event>({
  name: 'events_community_group_or_section_check',
  expression: (columns) =>
    `("${columns.communityGroup}" is not null and "${columns.communitySection}" is null) or ("${columns.communityGroup}" is null and "${columns.communitySection}" is not null)`,
})
// numericCode's namespace is per-EventType, not global (see that field's
// own comment) - enforced here as a composite unique constraint, not a
// plain @Unique() on the column alone.
@Unique({
  name: EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX,
  properties: ['type', 'numericCode'],
})
@Check<Event>({
  name: 'events_numeric_code_check',
  expression: (columns) => `"${columns.numericCode}" ~ '^[0-9]{6}$'`,
})
export class Event extends BaseEntity {
  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'no action' })
  communityGroup: Group | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'no action' })
  communitySection: Section | null = null;

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

  // Immutable after creation - see create-event.schema.ts (required on
  // CREATE) and update-event.schema.ts (absent from UPDATE entirely, and
  // EventsService.update never assigns this field). Not just a validation
  // rule: there is structurally no code path that can write `type` after
  // the Event is constructed in EventsService.create.
  @Enum({ items: () => Object.values(EventType) })
  type: EventType = EventType.OTHER;

  // Only meaningful when type === OTHER; null otherwise (enforced by the
  // create schema, not the DB). Free text, not a second enum, since
  // organizer-defined event kinds are inherently open-ended. Excluded from
  // UPDATE together with `type` in this stage - editing the label
  // independently of `type` is not modeled yet.
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

  // Stable, immutable 6-digit code, generated once at creation (see
  // EventsService.create via common/utils/numeric-code.ts) - a separate
  // namespace/purpose from publicCode above, and the payload behind this
  // Event's QR identity (see common/identity/qr-payload.util.ts). Unique
  // only within its own `type` (see EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX
  // above), never globally: since `type` is immutable, the full public
  // code (type + numericCode) is stable for the Event's entire lifecycle -
  // archiving/cancelling never frees or regenerates it. Not a secret and
  // not an authorization token: resolving it is still gated by the normal
  // visibility rules (see events.service.ts), the same as publicCode.
  //
  // No separate single-column index here - every real lookup path queries
  // (type, numericCode) together (see EventAccessService.
  // loadByTypeAndCodeOrFail), which the composite unique constraint above
  // already backs with its own index.
  @Property({ length: 6 })
  numericCode!: string;
}
