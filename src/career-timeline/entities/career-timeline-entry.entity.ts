import { Entity, Enum, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Event } from '../../events/entities/event.entity';
import { Group } from '../../groups/entities/group.entity';
import { Section } from '../../groups/entities/section.entity';
import { User } from '../../users/entities/user.entity';
import {
  CareerTimelineEntryType,
  CareerTimelinePrecision,
} from '../enums/career-timeline-entry-type.enum';

// The only persisted career-timeline data - every SYSTEM item (see the
// module's own comment on CareerTimelineOrigin) is built at read time from
// User/FormalGroupAffiliation/FormalRankAssignment/RoleAssignment - see
// career-timeline-aggregation.service.ts. A row here is always
// user-authored (origin MANUAL by construction - there is no `origin`
// column, since no other value is ever possible for a persisted row).
//
// `group`/`section`/`event` are optional evidence links, never required:
// the user may be recalling something CapoHub has no matching object for
// (a pre-CapoHub group, an event that predates this feature). `group`,
// `section` and `event` each carry a snapshot of the fields actually
// displayed alongside the relation - if the linked Group/Section/Event is
// edited (renamed, moved, rescheduled) years later, or the relation is
// severed (`set null` on delete), the entry keeps what it displayed at
// creation time rather than silently drifting or losing context (see the
// module spec, "zachowuj snapshot label/name obok relacji", and the
// redesign audit §3, which found the original "Events are never hard-
// deleted, so no snapshot is needed" reasoning addressed only deletion,
// not editing).
@Entity({ tableName: 'career_timeline_entries' })
export class CareerTimelineEntry extends BaseEntity {
  @Index()
  @ManyToOne(() => User, { deleteRule: 'cascade' })
  user!: User;

  @Index()
  @Enum({ items: () => Object.values(CareerTimelineEntryType) })
  type!: CareerTimelineEntryType;

  // Date-only, normalized per `occurredOnPrecision` (MONTH/YEAR round down
  // to the 1st) - never in the future, enforced in
  // CareerTimelineEntriesService (depends on "now" at write time, not
  // knowable here).
  @Property({ type: 'date' })
  occurredOn!: Date;

  @Enum({
    items: () => Object.values(CareerTimelinePrecision),
    default: CareerTimelinePrecision.DAY,
  })
  occurredOnPrecision: CareerTimelinePrecision = CareerTimelinePrecision.DAY;

  // Always populated - either user-entered (OTHER/IMPORTANT_EVENT/
  // ACHIEVEMENT) or generated server-side from the type-specific fields
  // below at create/update time (see CareerTimelineEntriesService.
  // buildTitle) - the frontend never has to reconstruct a title itself.
  @Property({ length: 200 })
  title!: string;

  @Property({ nullable: true, type: 'text' })
  description: string | null = null;

  @Index()
  @ManyToOne(() => Group, { nullable: true, deleteRule: 'set null' })
  group: Group | null = null;

  @Property({ length: 200, nullable: true })
  groupNameSnapshot: string | null = null;

  @Index()
  @ManyToOne(() => Section, { nullable: true, deleteRule: 'set null' })
  section: Section | null = null;

  @Property({ length: 200, nullable: true })
  sectionNameSnapshot: string | null = null;

  @Index()
  @ManyToOne(() => Event, { nullable: true, deleteRule: 'set null' })
  event: Event | null = null;

  // Snapshot of exactly the fields the timeline card actually displays
  // (name, date, location - redesign audit §3) - deliberately not a full
  // copy of Event (type/endsAt/organizer stay live-joined via `event`
  // above, since they're secondary and Events are never hard-deleted, only
  // edited). Captured once at create/update time
  // (CareerTimelineEntriesService.resolveEvent) from whatever the Event
  // looked like *then* - an organizer renaming, rescheduling, or relocating
  // the Event afterwards must not retroactively rewrite what this entry
  // says happened.
  @Property({ length: 200, nullable: true })
  eventNameSnapshot: string | null = null;

  @Property({ type: 'timestamptz', nullable: true })
  eventStartsAtSnapshot: Date | null = null;

  @Property({ length: 200, nullable: true })
  eventLocationNameSnapshot: string | null = null;

  // RECEIVED_APELIDO only.
  @Property({ length: 100, nullable: true })
  apelido: string | null = null;

  // RECEIVED_RANK (manual) only - free text, deliberately not a Rank
  // catalog reference: a manually-logged rank has no cord/track/segments to
  // render, unlike the SYSTEM RECEIVED_RANK item built from
  // FormalRankAssignment.
  @Property({ length: 100, nullable: true })
  rankName: string | null = null;

  // RECEIVED_APELIDO / RECEIVED_RANK - "nadał(a)".
  @Property({ length: 200, nullable: true })
  awardedByName: string | null = null;

  // City/place - START_TRAINING, BATIZADO, STARTED_TEACHING,
  // STARTED_SECTION, FOUNDED_GROUP, IMPORTANT_EVENT.
  @Property({ length: 200, nullable: true })
  location: string | null = null;
}
