import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import { EventRsvpStatus } from '../events/enums/event-rsvp-status.enum';
import { EventResponseDto } from '../events/dto/event-response.dto';
import { EventsService } from '../events/events.service';
import { Group } from '../groups/entities/group.entity';
import { Section } from '../groups/entities/section.entity';
import { GroupHierarchyService } from '../groups/group-hierarchy.service';
import { TrainingsService } from '../trainings/trainings.service';
import { User } from '../users/entities/user.entity';
import { sortCalendarItems } from './calendar-sort.util';
import { CalendarRangeQueryInput } from './dto/calendar-range-query.schema';
import { CalendarItemDto, CalendarResponseDto } from './dto/calendar-item.dto';
import {
  toCalendarEventItem,
  toCalendarTrainingItem,
} from './mappers/calendar-item.mapper';

// A generous but explicit safety net for the two Section/Group calendar
// sources (both backed by EventsService.list/TrainingsService.list, which
// paginate a potentially large, community-wide table) - never a silent
// truncation (module spec §13 "zwróć jawny błąd/flagę zamiast cichego
// ucinania"). Not applied to the two User Calendar sources below: those
// are participation/membership-scoped (how many Sections one person
// belongs to, how many Events one person is actually registered for or
// runs), which is inherently small regardless of community size.
const CALENDAR_SOURCE_ITEM_HARD_LIMIT = 500;

// Aggregates Event and Training into one read-only, merged, sorted
// timeline - never a new source of truth, never a new access rule (module
// spec §16 "CalendarService nie może zostać nowym miejscem z uproszczonymi
// zasadami dostępu"). Every visibility decision is made by
// EventsService/TrainingsService themselves, exactly as their own
// controllers already call them - this service only decides *which*
// existing query to call for a given calendar (module spec §4/§5/§6), then
// merges, slims, and sorts the results.
@Injectable()
export class CalendarService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventsService: EventsService,
    private readonly trainingsService: TrainingsService,
    private readonly groupHierarchyService: GroupHierarchyService,
  ) {}

  /**
   * GET /users/me/calendar - "my plan", not a catalog of everything
   * `viewer` could see (module spec §4). Trainings: every Section they
   * currently have an active membership in, regardless of their own RSVP.
   * Events: only ones they are actually a participant of (registered
   * attendee or Event role holder) - never a PUBLIC Event they merely
   * could see. See EventsService.findForViewerInRange/
   * TrainingsService.findForViewerSectionsInRange for the exact rules.
   */
  async getUserCalendar(
    viewer: User,
    range: CalendarRangeQueryInput,
  ): Promise<CalendarResponseDto> {
    // Sequential, not Promise.all - concurrent queries on the same
    // EntityManager/connection race each other at the driver level (same
    // convention as EventsService/TrainingsService throughout this
    // codebase).
    const events = await this.eventsService.findForViewerInRange(
      viewer,
      range.from,
      range.to,
    );
    const trainings = await this.trainingsService.findForViewerSectionsInRange(
      viewer,
      range.from,
      range.to,
    );
    const viewerRsvpByEvent = await this.loadViewerEventRsvps(viewer, events);

    const items: CalendarItemDto[] = [
      ...events.map((event) =>
        toCalendarEventItem(event, viewerRsvpByEvent.get(event.id) ?? null),
      ),
      ...trainings.map(toCalendarTrainingItem),
    ];

    return { from: range.from, to: range.to, items: sortCalendarItems(items) };
  }

  /**
   * GET /sections/:sectionId/calendar - Trainings and Events belonging
   * exactly to this Section, no inheritance from a parent Group or any
   * other Section (module spec §5). Access (MEMBERS_ONLY Training, Event
   * visibility) is resolved entirely inside TrainingsService.list/
   * EventsService.list, exactly as their own controllers already delegate
   * it - never re-derived here.
   */
  async getSectionCalendar(
    sectionId: string,
    viewer: User,
    range: CalendarRangeQueryInput,
  ): Promise<CalendarResponseDto> {
    const community = await this.groupHierarchyService.findCommunityById(
      sectionId,
      this.em,
    );
    if (!community || !(community instanceof Section)) {
      throw this.sectionNotFound();
    }

    // Sequential, not Promise.all - see getUserCalendar's identical
    // comment above.
    const trainingsResult = await this.trainingsService.list(
      sectionId,
      viewer,
      {
        from: range.from,
        to: range.to,
        limit: CALENDAR_SOURCE_ITEM_HARD_LIMIT + 1,
        offset: 0,
      },
    );
    this.assertNotTooManyItems(trainingsResult.items.length, 'trainings');

    const eventsResult = await this.eventsService.list(sectionId, viewer, {
      from: range.from,
      to: range.to,
      limit: CALENDAR_SOURCE_ITEM_HARD_LIMIT + 1,
      offset: 0,
    });
    this.assertNotTooManyItems(eventsResult.items.length, 'events');

    const viewerRsvpByEvent = await this.loadViewerEventRsvps(
      viewer,
      eventsResult.items,
    );

    const items: CalendarItemDto[] = [
      ...eventsResult.items.map((event) =>
        toCalendarEventItem(event, viewerRsvpByEvent.get(event.id) ?? null),
      ),
      ...trainingsResult.items.map(toCalendarTrainingItem),
    ];

    return { from: range.from, to: range.to, items: sortCalendarItems(items) };
  }

  /**
   * GET /groups/:groupId/calendar - Events belonging exactly to this
   * Group. A Group never owns a Training directly (module spec §6), and
   * this never aggregates child Groups/Sections - each Community's
   * calendar is its own.
   */
  async getGroupCalendar(
    groupId: string,
    viewer: User,
    range: CalendarRangeQueryInput,
  ): Promise<CalendarResponseDto> {
    const community = await this.groupHierarchyService.findCommunityById(
      groupId,
      this.em,
    );
    if (!community || !(community instanceof Group)) {
      throw this.groupNotFound();
    }

    const eventsResult = await this.eventsService.list(groupId, viewer, {
      from: range.from,
      to: range.to,
      limit: CALENDAR_SOURCE_ITEM_HARD_LIMIT + 1,
      offset: 0,
    });
    this.assertNotTooManyItems(eventsResult.items.length, 'events');

    const viewerRsvpByEvent = await this.loadViewerEventRsvps(
      viewer,
      eventsResult.items,
    );

    const items: CalendarItemDto[] = eventsResult.items.map((event) =>
      toCalendarEventItem(event, viewerRsvpByEvent.get(event.id) ?? null),
    );

    return { from: range.from, to: range.to, items: sortCalendarItems(items) };
  }

  /**
   * One bulk query per calendar request, never one per item (module spec
   * §17 "Nie rób N+1 na każdy CalendarItem") - the caller's own
   * EventAttendee row (if any) for each of the given Events, purely as
   * enrichment on `viewerRsvp` (never a filter - see
   * CalendarEventItemDto.viewerRsvp's own comment).
   */
  private async loadViewerEventRsvps(
    viewer: User,
    events: EventResponseDto[],
  ): Promise<Map<string, EventRsvpStatus>> {
    if (events.length === 0) {
      return new Map();
    }
    const rows = await this.em.find(
      EventAttendee,
      {
        event: { $in: events.map((event) => event.id) },
        subjectUser: viewer.id,
      },
      { fields: ['event', 'rsvpStatus'] },
    );
    const map = new Map<string, EventRsvpStatus>();
    for (const row of rows) {
      map.set(row.event.id, row.rsvpStatus);
    }
    return map;
  }

  private assertNotTooManyItems(count: number, sourceLabel: string): void {
    if (count > CALENDAR_SOURCE_ITEM_HARD_LIMIT) {
      throw new BadRequestException({
        code: 'CALENDAR_RANGE_TOO_LARGE',
        message: `Too many ${sourceLabel} in the requested date range - narrow from/to and try again`,
      });
    }
  }

  private sectionNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'SECTION_NOT_FOUND',
      message: 'Section not found',
    });
  }

  private groupNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GROUP_NOT_FOUND',
      message: 'Group not found',
    });
  }
}
