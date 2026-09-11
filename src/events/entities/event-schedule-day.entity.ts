import { Check, Entity, Index, ManyToOne, Property } from '@mikro-orm/core';
import { BaseEntity } from '../../database/entities/base.entity';
import { Event } from './event.entity';

// One day's own start/end window within a multi-day Event (module: "w
// piątek wydarzenie trwa do 18, w sobotę zaczyna się o 9 i trwa do 18, a w
// niedzielę od 10 do 16... jak to ugryźć?") - a single-day Event has none of
// these rows at all, it relies purely on Event.startsAt/endsAt as before.
// Event.startsAt/endsAt remain the one overall frame every schedule day must
// fall within, and remain the only fields RSVP/capacity/waitlist/
// notifications/calendar-range-filtering ever look at - this table is
// purely descriptive, shown on the Event's own detail screen, same "no
// per-day RSVP, no per-day capacity" boundary the module spec drew.
// Always replaced as a whole list by EventsService.finalizeCreate/update -
// never patched day-by-day - so there is no per-day update endpoint, same
// convention as RankCordSegment.
@Entity({ tableName: 'event_schedule_days' })
@Check<EventScheduleDay>({
  name: 'event_schedule_days_ends_at_after_starts_at_check',
  expression: (columns) => `"${columns.endsAt}" >= "${columns.startsAt}"`,
})
export class EventScheduleDay extends BaseEntity {
  // Owned child row - cascades with its Event.
  @Index()
  @ManyToOne(() => Event, { deleteRule: 'cascade' })
  event!: Event;

  @Property({ type: 'timestamptz' })
  startsAt!: Date;

  @Property({ type: 'timestamptz' })
  endsAt!: Date;
}
