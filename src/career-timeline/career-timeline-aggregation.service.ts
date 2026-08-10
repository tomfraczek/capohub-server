import { Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { EventAccessService } from '../events/event-access.service';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import { EventStatus } from '../events/enums/event-status.enum';
import { PARTICIPATING_RSVP_STATUSES } from '../events/event-participation.util';
import { FormalRankCorrectionService } from '../graduation/formal-rank-correction.service';
import { FormalRankAssignment } from '../graduation/entities/formal-rank-assignment.entity';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { User } from '../users/entities/user.entity';
import { CareerTimelineQueryInput } from './dto/career-timeline-query.schema';
import { CareerTimelineItemDto } from './dto/career-timeline-item.dto';
import { CareerTimelineResponseDto } from './dto/career-timeline-response.dto';
import { CareerTimelineEntry } from './entities/career-timeline-entry.entity';
import { CareerTimelineCategory } from './enums/career-timeline-category.enum';
import {
  buildCapoeiraStartItem,
  buildCustomItem,
  buildEventItem,
  buildFormalGroupJoinedItem,
  buildFormalGroupLeftItem,
  buildFormalRankItem,
} from './mappers/career-timeline.mapper';

const ALL_CATEGORIES = Object.values(CareerTimelineCategory);

const RANK_POPULATE = ['rank.cordSegments', 'sourceGroup', 'event'] as const;

/**
 * Read-time aggregation across every career-timeline source (see the module
 * spec, "Model agregacji"): nothing is copied into a single table except
 * manual entries (CareerTimelineEntry). Every automatic category is built
 * fresh, per request, from its owning source - User.capoeiraStartedAt,
 * FormalGroupAffiliation, FormalRankAssignment, EventAttendee - then merged,
 * filtered, sorted and paginated in application code. There is no
 * background sync job of any kind.
 *
 * Visibility is resolved once per category, per request:
 *  - the owner (isOwner) always sees everything;
 *  - a non-owner viewer only sees the whole endpoint at all when
 *    `target.showCareerTimeline` is true, and even then each category is
 *    additionally gated by the privacy toggle for its *underlying* source
 *    data (showFormalGroup, showFormalRank, showEventParticipation) - never
 *    a per-category timeline toggle of its own (explicitly rejected by the
 *    spec).
 *  - FORMAL_RANK reuses FormalRankCorrectionService.isPubliclyVisible and
 *    EVENT reuses EventAccessService.isVisibleToViewer rather than
 *    re-deriving either rule.
 */
@Injectable()
export class CareerTimelineAggregationService {
  constructor(
    private readonly em: EntityManager,
    private readonly formalRankCorrectionService: FormalRankCorrectionService,
    private readonly eventAccessService: EventAccessService,
  ) {}

  async getTimeline(
    viewer: User,
    targetUserId: string,
    query: CareerTimelineQueryInput,
  ): Promise<CareerTimelineResponseDto> {
    const target =
      viewer.id === targetUserId
        ? viewer
        : await this.em.findOne(User, { id: targetUserId });
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    const isOwner = viewer.id === target.id;

    if (!isOwner && !target.showCareerTimeline) {
      return { items: [], total: 0, hasMore: false };
    }

    const categories = new Set(query.categories ?? ALL_CATEGORIES);
    const items: CareerTimelineItemDto[] = [];

    if (
      categories.has(CareerTimelineCategory.CAPOEIRA_START) &&
      (isOwner || target.showCapoeiraStartedAt) &&
      target.capoeiraStartedAt
    ) {
      items.push(buildCapoeiraStartItem(target));
    }

    if (
      (categories.has(CareerTimelineCategory.FORMAL_GROUP_JOINED) ||
        categories.has(CareerTimelineCategory.FORMAL_GROUP_LEFT)) &&
      (isOwner || target.showFormalGroup)
    ) {
      const affiliations = await this.em.find(
        FormalGroupAffiliation,
        { user: target.id },
        { populate: ['group'] },
      );
      for (const affiliation of affiliations) {
        if (
          categories.has(CareerTimelineCategory.FORMAL_GROUP_JOINED) &&
          affiliation.startedOn
        ) {
          items.push(buildFormalGroupJoinedItem(affiliation));
        }
        if (
          categories.has(CareerTimelineCategory.FORMAL_GROUP_LEFT) &&
          affiliation.endedOn
        ) {
          items.push(buildFormalGroupLeftItem(affiliation));
        }
      }
    }

    // Populated whenever FORMAL_RANK is actually rendered into this
    // timeline (whether or not EVENT is also requested), so an Event linked
    // to a rank is never *also* returned as a separate EVENT item in the
    // same response (see the module spec, rule 6). Never suppressed by an
    // active correction on the assignment - the Event participation is a
    // separate, still-true fact independent of which Rank value is
    // currently shown.
    const linkedEventIds = new Set<string>();

    if (
      categories.has(CareerTimelineCategory.FORMAL_RANK) &&
      (isOwner || target.showFormalRank)
    ) {
      const assignments = await this.em.find(
        FormalRankAssignment,
        { user: target.id, startedOn: { $ne: null } },
        { populate: RANK_POPULATE },
      );
      for (const assignment of assignments) {
        if (assignment.event) {
          linkedEventIds.add(assignment.event.id);
        }
        if (!isOwner) {
          const visible =
            await this.formalRankCorrectionService.isPubliclyVisible(
              assignment.id,
            );
          if (!visible) {
            continue;
          }
        }
        items.push(buildFormalRankItem(assignment));
      }
    }

    if (
      categories.has(CareerTimelineCategory.EVENT) &&
      (isOwner || target.showEventParticipation)
    ) {
      const attendeeRows = await this.em.find(
        EventAttendee,
        { subjectUser: target.id },
        { populate: ['event.communityGroup', 'event.communitySection'] },
      );
      for (const attendee of attendeeRows) {
        const event = attendee.event;
        if (linkedEventIds.has(event.id)) {
          continue;
        }
        // Actual recorded attendance (EventAttendee.checkedIn - see the
        // Event Attendance module spec §16) is a better source of truth
        // than RSVP once it exists: `checkedInAt !== null` means a real
        // decision was recorded (present or explicitly absent - see
        // EventAttendanceService.applyAttendance), which then fully
        // decides inclusion, RSVP or not. Only falls back to RSVP GOING
        // when no attendance was ever recorded, so Events that predate
        // this feature (or were simply never checked) keep working exactly
        // as before - no backfill required.
        if (attendee.checkedInAt !== null) {
          if (!attendee.checkedIn) {
            continue;
          }
        } else if (!PARTICIPATING_RSVP_STATUSES.includes(attendee.rsvpStatus)) {
          continue;
        }
        // Judgment call (no dedicated "training" flag exists on Event, see
        // the module's final report): every EventType qualifies. Only
        // "has started or finished" and "not cancelled" gate inclusion.
        if (event.startsAt.getTime() > Date.now()) {
          continue;
        }
        if (event.status === EventStatus.CANCELLED) {
          continue;
        }
        if (
          !isOwner &&
          !(await this.eventAccessService.isVisibleToViewer(
            this.em,
            event,
            viewer.id,
            viewer.email,
          ))
        ) {
          continue;
        }
        items.push(buildEventItem(event));
      }
    }

    if (
      categories.has(CareerTimelineCategory.CUSTOM) &&
      (isOwner || target.showCareerTimeline)
    ) {
      const entries = await this.em.find(CareerTimelineEntry, {
        user: target.id,
      });
      for (const entry of entries) {
        items.push(buildCustomItem(entry));
      }
    }

    const filtered = items.filter((item) => {
      if (query.dateFrom && item.occurredOn < query.dateFrom) {
        return false;
      }
      if (query.dateTo && item.occurredOn > query.dateTo) {
        return false;
      }
      return true;
    });

    // Descending by occurredOn, deterministic tie-break by the item's own
    // stable id (see the module spec, "z deterministycznym tie-breakerem") -
    // any consistent secondary key works, the id is simply already unique
    // and available.
    filtered.sort((a, b) => {
      if (a.occurredOn !== b.occurredOn) {
        return a.occurredOn < b.occurredOn ? 1 : -1;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });

    const total = filtered.length;
    const page = filtered.slice(query.offset, query.offset + query.limit);
    const hasMore = query.offset + page.length < total;

    return { items: page, total, hasMore };
  }
}
