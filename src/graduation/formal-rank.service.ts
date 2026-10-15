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
import { FormalRankAssignment } from './entities/formal-rank-assignment.entity';
import {
  FORMAL_RANK_REQUESTS_PENDING_UNIQUE_INDEX,
  FormalRankRequest,
} from './entities/formal-rank-request.entity';
import { SetFormalRankInput } from './dto/set-formal-rank.schema';
import { FormalRankAssignmentResponseDto } from './dto/formal-rank-assignment-response.dto';
import { PendingFormalRankResponseDto } from './dto/formal-rank-request-response.dto';
import { toFormalRankAssignmentResponseDto } from './mappers/formal-rank-assignment.mapper';
import { toOwnFormalRankRequestResponseDto } from './mappers/formal-rank-request.mapper';
import { confirmsOwnRankImmediately } from './own-rank-confirmation';
import { FormalRankRequestsService } from './formal-rank-requests.service';
import {
  assignFormalRank,
  cancelPendingFormalRankRequests,
  startOfTodayUtc,
} from './rank-transitions';

// `user` for the holder's gender - see formal-rank-assignment.mapper.ts.
const RANK_POPULATE = [
  'user',
  'rank.cordSegments',
  'sourceGroup',
  'event',
] as const;

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// Owns FormalRankAssignment - the global, per-user (never per-Group/per-
// Section) source of truth for a capoeirista's current and historical
// *formal* rank (see formal-rank-assignment.entity.ts). Only ever a
// catalog Rank, chosen from the caller's active FormalGroupAffiliation's
// Group - there is no "custom" path through this service at all (see
// CustomUserRankService for the independent rank).
//
// Choosing a formal rank is a *declaration* that someone authorized in the
// Group has to confirm (FormalRankRequest - see
// FormalRankRequestsService): setCurrent never writes the assignment
// itself, except for the formal Group's own OWNER/ADMIN, who hold that
// very confirming permission. Until then the user's previous rank (formal
// from another Group, or independent) stays current and unchanged.
@Injectable()
export class FormalRankService {
  constructor(
    private readonly em: EntityManager,
    private readonly eventAccessService: EventAccessService,
    private readonly formalRankRequestsService: FormalRankRequestsService,
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

  /**
   * Validates the choice exactly as before (rank from the caller's formal
   * Group's catalog, not archived, startedOn not in the future, Event
   * evidence eligible), then:
   *  - the formal Group's OWNER/ADMIN: confirmed immediately - becomes the
   *    current rank (assignFormalRank ends the previous one, formal or
   *    independent, as history);
   *  - anyone else: a PENDING FormalRankRequest for that Group's reviewers,
   *    replacing a previous pending one. The current rank is untouched.
   */
  async setCurrent(
    user: User,
    input: SetFormalRankInput,
  ): Promise<FormalRankAssignmentResponseDto | PendingFormalRankResponseDto> {
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
      const awardedByName = input.awardedByName ?? null;

      if (await confirmsOwnRankImmediately(em, user.id, formalGroup.group.id)) {
        await cancelPendingFormalRankRequests(em, user.id);
        const assignment = await assignFormalRank(em, {
          user,
          rank,
          group: formalGroup.group,
          startedOn,
          awardedByName,
          event,
        });
        return toFormalRankAssignmentResponseDto(assignment);
      }

      await cancelPendingFormalRankRequests(em, user.id);
      const request = new FormalRankRequest();
      request.user = user;
      request.group = formalGroup.group;
      request.rank = rank;
      request.startedOn = startedOn;
      request.awardedByName = awardedByName;
      request.event = event;
      try {
        em.persist(request);
        await em.flush();
      } catch (error) {
        if (
          isUniqueViolationOn(error, FORMAL_RANK_REQUESTS_PENDING_UNIQUE_INDEX)
        ) {
          throw new ConflictException({
            code: 'FORMAL_RANK_REQUEST_ALREADY_PENDING',
            message: 'A concurrent change already sent a rank request',
          });
        }
        throw error;
      }
      await this.formalRankRequestsService.notifyReviewers(em, request);
      return { pendingRequest: toOwnFormalRankRequestResponseDto(request) };
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
