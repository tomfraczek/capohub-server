import {
  Check,
  Collection,
  Entity,
  Enum,
  Index,
  ManyToOne,
  OneToMany,
  Property,
  Unique,
} from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Group } from '../../groups/entities/group.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import { EventOrganizerType } from '../enums/event-organizer-type.enum';
import { EventStatus } from '../enums/event-status.enum';
import { EventType } from '../enums/event-type.enum';
import { EventVisibility } from '../enums/event-visibility.enum';
import { EventParticipantsVisibility } from '../enums/event-participants-visibility.enum';
import { EventWaitlistPolicy } from '../enums/event-waitlist-policy.enum';
import { EventScheduleDay } from './event-schedule-day.entity';

export const EVENTS_TYPE_NUMERIC_CODE_UNIQUE_INDEX =
  'events_type_numeric_code_unique';

// Has exactly one public organizer identity - a Group, a Section, or a
// User organizing directly - never more than one, never none, and never
// moved afterwards (spec: "Nie przewidujemy późniejszego przenoszenia
// Eventu pomiędzy Community", extended here to organizerUser: there is
// deliberately no "change organizer" operation anywhere in this module -
// see event-community.util.ts's assignEventCommunity/
// assignEventOrganizerUser, each only ever called once, at creation).
// Represented by an explicit `organizerType` discriminator plus three
// nullable FKs/fields - communityGroup/communitySection date from the
// Group/Section physical split (see GroupHierarchyService.findCommunityById
// for resolving whichever one is populated); organizerUser +
// organizerUserDisplayName were added alongside them for the User-as-
// organizer case (module: "Event Organizer: USER | GROUP | SECTION").
//
// `organizerType` exists as its own column, not just derived from which FK
// is set, because organizerUser is allowed to go null on its own (see its
// own comment below) while the Event is still, unambiguously, USER-
// organized - without a separate discriminator, a User-organized Event
// whose organizer account was deleted would be indistinguishable from "no
// organizer set at all" (module: "USER organizer - zachowanie historii").
//
// Deliberately distinct from two other, easily-confused concepts:
// `createdBy` below (immutable audit provenance, never shown to
// participants as "the organizer") and EventRole.OWNER (a transferable
// *administrative* role held by a User managing the Event day-to-day -
// see event-role-assignment.entity.ts) - a Group/Section-organized Event's
// OWNER is just one of potentially many Community members with management
// access, not the public organizer identity itself; a User-organized
// Event's OWNER happens to start out as the same User as organizerUser,
// but transferOwnership only ever moves the administrative role, never
// organizerUser (see EventRolesService.transferOwnership).
@Entity({ tableName: 'events' })
@Index({ properties: ['communityGroup', 'status'] })
@Index({ properties: ['communitySection', 'status'] })
// Discriminator-driven, not a plain "exactly one of three FKs" check
// anymore (see the class comment above and organizerUser's own comment
// below on why organizerUser alone can no longer distinguish USER from
// "unset"): each organizerType branch pins down exactly which of
// communityGroup/communitySection/organizerUserDisplayName must be set.
// `organizerUser` is deliberately NOT constrained here at all in the USER
// branch - it starts non-null and may later become null (ON DELETE SET
// NULL - see its own comment), and both are valid. Mirrored here so
// migration:create/schema:update know this constraint is intentional and
// never propose dropping it. Name matches the constraint the migration
// creates verbatim - see Migration20260824074804_AddEventArchivedAndOrganizerSnapshot
// (which replaced events_organizer_check from
// Migration20260821123136_AddEventOrganizerUser).
@Check<Event>({
  name: 'events_organizer_identity_check',
  expression: (columns) =>
    `("${columns.organizerType}" = 'GROUP' and "${columns.communityGroup}" is not null and "${columns.communitySection}" is null and "${columns.organizerUserDisplayName}" is null)` +
    ` or ("${columns.organizerType}" = 'SECTION' and "${columns.communitySection}" is not null and "${columns.communityGroup}" is null and "${columns.organizerUserDisplayName}" is null)` +
    ` or ("${columns.organizerType}" = 'USER' and "${columns.communityGroup}" is null and "${columns.communitySection}" is null and "${columns.organizerUserDisplayName}" is not null)`,
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

  // Discriminates which organizer branch is in effect - see the class
  // comment above. Set once, at creation (assignEventCommunity/
  // assignEventOrganizerUser), and never changed afterwards.
  @Index()
  @Enum({ items: () => Object.values(EventOrganizerType) })
  organizerType!: EventOrganizerType;

  // Set only when this Event's public organizer is a User directly, rather
  // than a Group/Section (see the class comment above and
  // event-community.util.ts's assignEventOrganizerUser). `deleteRule:
  // 'set null'` (like `createdBy` below, unlike communityGroup/
  // communitySection) - this User account CAN be physically deleted
  // (DELETE /users/me) even while still an Event's organizer, because
  // `organizerType`/`organizerUserDisplayName` (not this FK) is what keeps
  // the Event's USER-organizer identity intact afterwards. See
  // UserService.deleteLocalAccountData /
  // EventsService.closeOrganizedEventsForAccountDeletion for the deletion
  // flow, and organizerUserDisplayName below for the surviving snapshot.
  @Index()
  @ManyToOne(() => User, { nullable: true, deleteRule: 'set null' })
  organizerUser: User | null = null;

  // Historical snapshot of the organizing User's displayName, taken once at
  // creation (assignEventOrganizerUser) - never re-synced if the User later
  // renames themselves (module decision: "Event zachowuje informację, pod
  // jaką nazwą organizator występował przy tworzeniu"). This, not
  // `organizerUser`, is what events_organizer_identity_check actually
  // requires non-null for organizerType === USER - so the Event's public
  // organizer name survives even after organizerUser goes null (account
  // deleted). Always null for organizerType GROUP/SECTION. Deliberately no
  // avatar/image snapshot alongside it: this codebase does not persist
  // historical copies of profile images (no R2/storage module exists yet -
  // see the module spec), so a deleted-account USER organizer simply has no
  // image (see mappers/event-organizer-ref.mapper.ts) - the frontend falls
  // back to initials, the same as it already would for any User with no
  // avatar.
  @Property({ nullable: true, length: 100 })
  organizerUserDisplayName: string | null = null;

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

  // Legacy URL field - still settable via PATCH (see update-event.schema.ts)
  // and still rendered as a fallback whenever coverImageKey is unset, but
  // no longer authoritative once an R2 cover has been uploaded (see
  // storage/image-url.util.ts's resolveImageUrl) - cleared to null the
  // moment that first upload happens (see EventsService.uploadCoverImage).
  // Deliberately distinct from the organizer's own avatar/logo (see
  // organizerUser/communityGroup/communitySection above) - an Event has no
  // separate uploaded "profile image", only this cover (module spec:
  // "Event NIE ma osobnego uploadowanego profile image").
  @Property({ nullable: true, length: 2048 })
  coverImageUrl: string | null = null;

  // R2 object key ("events/{id}/cover/{uuid}.webp" - see
  // storage/object-keys.util.ts) for this Event's uploaded cover image;
  // null until the first upload.
  @Property({ nullable: true, length: 512 })
  coverImageKey: string | null = null;

  @Index()
  @Property({ type: 'timestamptz' })
  startsAt!: Date;

  @Index()
  @Property({ type: 'timestamptz' })
  endsAt!: Date;

  // Optional per-day breakdown of startsAt/endsAt (module: "w piątek
  // wydarzenie trwa do 18, w sobotę zaczyna się o 9... jak to ugryźć?") -
  // purely descriptive, always replaced as a whole list (see
  // EventScheduleDay's own comment). Empty for the common single-day case;
  // startsAt/endsAt above stay the one frame everything else (RSVP,
  // capacity, waitlist, notifications, calendar range filtering) actually
  // operates on.
  @OneToMany(() => EventScheduleDay, (day) => day.event)
  scheduleDays = new Collection<EventScheduleDay>(this);

  // Whether the event spans multiple calendar days is deliberately NOT a
  // stored field - it is always derivable from startsAt/endsAt (see
  // ADR-027: read models are not authoritative) and is computed in
  // event.mapper.ts. "Wielodniowość" itself needs no separate flag: the
  // date range already supports it; storing a redundant boolean would risk
  // drifting from the dates that actually define it.

  // Same address shape as Academy (the existing "location" model in this
  // codebase) rather than inventing a second one. All nullable: a Draft
  // event may not have a location decided yet. No latitude/longitude -
  // module: "szerokość i długość geograficzna nie jest potrzebna, usuń to
  // z frontendu i backendu" (nothing in this codebase ever queried Events
  // by distance/coordinates - unlike Section, which genuinely needs them
  // for nearby-discovery).
  @Property({ nullable: true, type: 'text' })
  locationName: string | null = null;

  @Property({ nullable: true, type: 'text' })
  locationAddress: string | null = null;

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

  // Whether non-staff viewers may see the participant list - see
  // event-participants-visibility.enum.ts.
  @Enum({ items: () => Object.values(EventParticipantsVisibility) })
  participantsVisibility: EventParticipantsVisibility =
    EventParticipantsVisibility.PRIVATE;

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
