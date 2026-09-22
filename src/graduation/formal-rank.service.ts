import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { EventAccessService } from '../events/event-access.service';
import { EventAttendee } from '../events/entities/event-attendee.entity';
import type { Event } from '../events/entities/event.entity';
import { PARTICIPATING_RSVP_STATUSES } from '../events/event-participation.util';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { User } from '../users/entities/user.entity';
import { Rank } from './entities/rank.entity';
import {
  FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  FormalRankAssignment,
} from './entities/formal-rank-assignment.entity';
import { SetFormalRankInput } from './dto/set-formal-rank.schema';
import { FormalRankAssignmentResponseDto } from './dto/formal-rank-assignment-response.dto';
import { toFormalRankAssignmentResponseDto } from './mappers/formal-rank-assignment.mapper';

const RANK_POPULATE = ['rank.cordSegments', 'sourceGroup', 'event'] as const;

function startOfTodayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// Owns FormalRankAssignment - the global, per-user (never per-Group/per-
// Section) source of truth for a capoeirista's current and historical
// *formal* rank (see formal-rank-assignment.entity.ts). Only ever a
// catalog Rank, chosen from the caller's active FormalGroupAffiliation's
// Group - there is no "custom" path through this service at all (see
// CustomUserRankService for that separate, non-historical concept). A
// user changing their own rank is a profile operation, not a community
// action, so it is deliberately NOT written to any Group's Audit Log (see
// the module spec: "Zmiana własnego stopnia użytkownika nie musi trafiać
// do community Audit Log").
@Injectable()
export class FormalRankService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
  ) {}

  /**
   * A 404 (RANK_NOT_SET) when there is no active assignment, not a 200
   * with an empty body - NestJS's Express adapter cannot send a literal
   * JSON `null` root body (returning null/undefined from a handler sends
   * an empty response instead).
   */
  async getCurrent(userId: string): Promise<FormalRankAssignmentResponseDto> {
    const current = await this.em.findOne(
      FormalRankAssignment,
      { user: userId, endedOn: null },
      { populate: RANK_POPULATE },
    );
    if (!current) {
      throw new NotFoundException({
        code: 'RANK_NOT_SET',
        message: 'No active formal rank',
      });
    }
    return toFormalRankAssignmentResponseDto(current);
  }

  /**
   * Same lookup as getCurrent, but for callers where "not set" is an
   * ordinary, expected outcome rather than a 404 - e.g.
   * UserProfileService.getPublicProfile resolving another user's formal
   * rank for the public profile surface, where most viewers simply
   * haven't set one. Returns the raw entity (not the DTO) so callers that
   * need the underlying Rank/sourceGroup for their own mapping (e.g. a
   * public, narrower DTO) don't have to re-fetch it.
   */
  async getCurrentOrNull(userId: string): Promise<FormalRankAssignment | null> {
    return this.em.findOne(
      FormalRankAssignment,
      { user: userId, endedOn: null },
      { populate: RANK_POPULATE },
    );
  }

  async getHistory(userId: string): Promise<FormalRankAssignmentResponseDto[]> {
    const assignments = await this.em.find(
      FormalRankAssignment,
      { user: userId },
      { populate: RANK_POPULATE, orderBy: { createdAt: 'desc' } },
    );
    return assignments.map(toFormalRankAssignmentResponseDto);
  }

  async setCurrent(
    user: User,
    input: SetFormalRankInput,
  ): Promise<FormalRankAssignmentResponseDto> {
    return this.em.transactional(async (em) => {
      const formalGroup = await this.loadActiveFormalGroup(em, user.id);
      if (!formalGroup) {
        throw new ConflictException({
          code: 'FORMAL_RANK_REQUIRES_FORMAL_GROUP',
          message:
            'Selecting a formal rank requires an active formal group affiliation',
        });
      }

      const rank = await em.findOne(
        Rank,
        { id: input.rankId },
        { populate: ['system.group', 'cordSegments'] },
      );
      if (!rank) {
        throw new NotFoundException({
          code: 'RANK_NOT_FOUND',
          message: 'Rank not found',
        });
      }
      if (rank.isArchived) {
        throw new ConflictException({
          code: 'RANK_ARCHIVED',
          message: 'This rank is archived and can no longer be newly selected',
        });
      }
      // The catalog must belong to the *exact* Group of the user's active
      // formal affiliation - never a Section, never a different Group the
      // user merely happens to belong to (see the module spec).
      if (rank.system.group.id !== formalGroup.group.id) {
        throw new ConflictException({
          code: 'RANK_NOT_IN_FORMAL_GROUP_CATALOG',
          message: "This rank does not belong to your formal group's catalog",
        });
      }

      const startedOn = input.startedOn ? parseDateOnly(input.startedOn) : null;
      if (startedOn && startedOn.getTime() > startOfTodayUtc().getTime()) {
        throw new BadRequestException({
          code: 'RANK_STARTED_ON_IN_FUTURE',
          message: 'startedOn cannot be in the future',
        });
      }

      const event = input.eventId
        ? await this.loadAndValidateEventLink(em, user, input.eventId)
        : null;

      const current = await em.findOne(FormalRankAssignment, {
        user: user.id,
        endedOn: null,
      });
      if (current) {
        current.endedOn = startOfTodayUtc();
        // Flushed before the new row is inserted below - see
        // FormalGroupAffiliation.setFormalGroup's identical ordering
        // comment: MikroORM applies inserts before updates within a
        // single flush, which would otherwise transiently violate
        // FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX.
        await em.flush();
      }

      // Selecting a formal Rank no longer touches CustomUserRank at all -
      // now that `isActive` is gone (see custom-user-rank.entity.ts), an
      // independent rank simply stays in the database untouched; which of
      // the two "counts" for display is a purely display-time computation
      // done by callers (e.g. UserProfileService.getPublicProfile), not
      // something this service enforces by mutating rows.
      const assignment = new FormalRankAssignment();
      assignment.user = user;
      assignment.rank = rank;
      assignment.sourceGroup = formalGroup.group;
      assignment.startedOn = startedOn;
      assignment.awardedByName = input.awardedByName ?? null;
      assignment.event = event;

      try {
        em.persist(assignment);
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(
            error,
            FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
          )
        ) {
          throw new ConflictException({
            code: 'RANK_ALREADY_SET',
            message: 'A concurrent change already set an active formal rank',
          });
        }
        throw error;
      }

      return toFormalRankAssignmentResponseDto(assignment);
    });
  }

  async endCurrent(user: User): Promise<void> {
    const current = await this.em.findOne(FormalRankAssignment, {
      user: user.id,
      endedOn: null,
    });
    if (!current) {
      throw new NotFoundException({
        code: 'RANK_NOT_SET',
        message: 'No active formal rank to end',
      });
    }
    current.endedOn = startOfTodayUtc();
    await this.em.flush();
  }

  private async loadActiveFormalGroup(
    em: EntityManager,
    userId: string,
  ): Promise<FormalGroupAffiliation | null> {
    return em.findOne(
      FormalGroupAffiliation,
      { user: userId, endedOn: null },
      { populate: ['group'] },
    );
  }

  /**
   * Evidence-link eligibility for `event` (see the module spec, "Powiązanie
   * stopnia z Eventem"): the caller must have actually attended it (an
   * EventAttendee row with subjectUser = user and a participating RSVP
   * status - see PARTICIPATING_RSVP_STATUSES), it must be in the past or
   * currently ongoing, and the caller must have the right to view it
   * (reuses EventAccessService.isVisibleToViewer rather than re-deriving
   * visibility). There is no separate "not a plain training" check: the
   * Event model has no flag distinguishing a training from any other Event
   * (see the module's final report) - every EventType is treated as
   * eligible, exactly as career-timeline-aggregation.service does for its
   * EVENT entries.
   */
  private async loadAndValidateEventLink(
    em: EntityManager,
    user: User,
    eventId: string,
  ): Promise<Event> {
    const event = await this.eventAccessService.loadOrFail(em, eventId);

    if (event.startsAt.getTime() > Date.now()) {
      throw new ConflictException({
        code: 'RANK_EVENT_NOT_STARTED',
        message: 'The linked event must be in the past or currently ongoing',
      });
    }

    const attended =
      (await em.count(EventAttendee, {
        event: eventId,
        subjectUser: user.id,
        rsvpStatus: { $in: PARTICIPATING_RSVP_STATUSES },
      })) > 0;
    if (!attended) {
      throw new ConflictException({
        code: 'RANK_EVENT_NOT_ATTENDED',
        message: 'You did not attend this event',
      });
    }

    const visible = await this.eventAccessService.isVisibleToViewer(
      em,
      event,
      user.id,
      user.email,
    );
    if (!visible) {
      throw new ConflictException({
        code: 'RANK_EVENT_NOT_VISIBLE',
        message: 'You do not have access to this event',
      });
    }

    return event;
  }
}
