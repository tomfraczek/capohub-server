import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { User } from '../users/entities/user.entity';
import { buildCordSegments } from './cord-segment-builder';
import { CreateCustomUserRankInput } from './dto/create-custom-user-rank.schema';
import { CustomUserRankResponseDto } from './dto/custom-user-rank-response.dto';
import { CustomUserRankCordSegment } from './entities/custom-user-rank-cord-segment.entity';
import {
  CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX,
  CustomUserRank,
} from './entities/custom-user-rank.entity';
import { toCustomUserRankResponseDto } from './mappers/custom-user-rank.mapper';
import {
  endActiveFormalRank,
  endActiveIndependentRank,
  startOfTodayUtc,
} from './rank-transitions';

// Owns CustomUserRank - the user's independent rank (see
// custom-user-rank.entity.ts): period-based like FormalRankAssignment, so a
// replaced independent rank stays in the user's history. GET/PUT/DELETE
// all resolve "the caller's *active* row" directly (no `:id`), scoped by
// `user: user.id`.
//
// Read-only while the caller has an active formal Group
// (INDEPENDENT_RANK_LOCKED_BY_FORMAL_GROUP): inside a formal Group a rank
// only ever comes from its graduation system, through a confirmed
// FormalRankRequest. The existing independent rank stays current and
// visible until such a rank is confirmed (which ends it - see
// rank-transitions.ts's assignFormalRank).
@Injectable()
export class CustomUserRankService {
  constructor(private readonly em: EntityManager) {}

  /**
   * A 404 (CUSTOM_RANK_NOT_SET) when the caller has no active independent
   * rank, not a 200 with an empty body - same reasoning as
   * FormalRankService.getCurrent.
   */
  async getCurrent(userId: string): Promise<CustomUserRankResponseDto> {
    const customRank = await this.findActive(userId);
    if (!customRank) {
      throw this.notSet();
    }
    return toCustomUserRankResponseDto(
      customRank,
      customRank.cordSegments.getItems(),
    );
  }

  /**
   * Same lookup as getCurrent, for callers where "not set" is an ordinary
   * outcome (e.g. the public profile). Returns the raw entity.
   */
  async getCurrentOrNull(userId: string): Promise<CustomUserRank | null> {
    return this.findActive(userId);
  }

  /**
   * Sets the caller's independent rank. Changing the rank itself (name,
   * track or cord) starts a new stint - the previous independent rank, or
   * a still-active formal rank from a Group the caller has since left, is
   * ended as history (one active rank per user). Only the description/
   * startedOn of the same rank are edited in place.
   */
  async setCurrent(
    user: User,
    input: CreateCustomUserRankInput,
  ): Promise<CustomUserRankResponseDto> {
    return this.em.transactional(async (em) => {
      await this.assertNotLockedByFormalGroup(em, user.id);

      const startedOn = input.startedOn ? parseDateOnly(input.startedOn) : null;
      if (startedOn && startedOn.getTime() > startOfTodayUtc().getTime()) {
        throw new BadRequestException({
          code: 'CUSTOM_RANK_STARTED_ON_IN_FUTURE',
          message: 'startedOn cannot be in the future',
        });
      }

      const existing = await this.findActive(user.id, em);
      if (existing && isSameRank(existing, input)) {
        existing.description = input.description;
        existing.startedOn = startedOn;
        await em.flush();
        return toCustomUserRankResponseDto(
          existing,
          existing.cordSegments.getItems(),
        );
      }

      await endActiveIndependentRank(em, user.id);
      await endActiveFormalRank(em, user.id);
      return this.createNew(em, user, input, startedOn);
    });
  }

  /**
   * Ends the caller's active independent rank (endedOn = today) - never a
   * physical delete any more, it stays in their history.
   */
  async deleteCurrent(user: User): Promise<void> {
    await this.em.transactional(async (em) => {
      await this.assertNotLockedByFormalGroup(em, user.id);
      const customRank = await this.findActive(user.id, em);
      if (!customRank) {
        throw this.notSet();
      }
      await endActiveIndependentRank(em, user.id);
    });
  }

  private async assertNotLockedByFormalGroup(
    em: EntityManager,
    userId: string,
  ): Promise<void> {
    const hasFormalGroup =
      (await em.count(FormalGroupAffiliation, {
        user: userId,
        endedOn: null,
      })) > 0;
    if (hasFormalGroup) {
      throw new ConflictException({
        code: 'INDEPENDENT_RANK_LOCKED_BY_FORMAL_GROUP',
        message:
          'The independent rank cannot be changed while you belong to a formal group',
      });
    }
  }

  private async createNew(
    em: EntityManager,
    user: User,
    input: CreateCustomUserRankInput,
    startedOn: Date | null,
  ): Promise<CustomUserRankResponseDto> {
    const customRank = new CustomUserRank();
    customRank.user = user;
    customRank.name = input.name;
    customRank.description = input.description;
    customRank.track = input.track;
    customRank.startedOn = startedOn;

    const segments = buildCordSegments(
      () => new CustomUserRankCordSegment(),
      input.cordSegments,
    );
    for (const segment of segments) {
      segment.customRank = customRank;
    }

    try {
      em.persist([customRank, ...segments]);
      await em.flush();
    } catch (error) {
      // Concurrent-set race backstop on the active-unique index - same
      // pattern as FormalRankAssignment's.
      if (isUniqueViolationOn(error, CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX)) {
        throw new ConflictException({
          code: 'CUSTOM_RANK_ALREADY_SET',
          message: 'A concurrent change already set your independent rank',
        });
      }
      throw error;
    }

    return toCustomUserRankResponseDto(customRank, segments);
  }

  private async findActive(
    userId: string,
    em: EntityManager = this.em,
  ): Promise<CustomUserRank | null> {
    return em.findOne(
      CustomUserRank,
      { user: userId, endedOn: null },
      { populate: ['cordSegments'] },
    );
  }

  private notSet(): NotFoundException {
    return new NotFoundException({
      code: 'CUSTOM_RANK_NOT_SET',
      message: 'No independent rank set',
    });
  }
}

function parseDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

// "The same rank" = same name, track and cord - what the rank *is*, as
// opposed to its description/startedOn, which are details of the stint.
function isSameRank(
  existing: CustomUserRank,
  input: CreateCustomUserRankInput,
): boolean {
  const current = [...existing.cordSegments.getItems()].sort(
    (a, b) => a.position - b.position,
  );
  const next = [...input.cordSegments].sort((a, b) => a.position - b.position);
  return (
    existing.name === input.name &&
    existing.track === input.track &&
    current.length === next.length &&
    current.every(
      (segment, index) =>
        segment.colorHex.toLowerCase() === next[index].colorHex.toLowerCase() &&
        segment.proportion === next[index].proportion,
    )
  );
}
