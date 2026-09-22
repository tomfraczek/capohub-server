import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from '../common/utils/db-errors';
import { User } from '../users/entities/user.entity';
import { buildCordSegments } from './cord-segment-builder';
import { CreateCustomUserRankInput } from './dto/create-custom-user-rank.schema';
import { CustomUserRankResponseDto } from './dto/custom-user-rank-response.dto';
import { CustomUserRankCordSegment } from './entities/custom-user-rank-cord-segment.entity';
import {
  CUSTOM_USER_RANKS_USER_UNIQUE_INDEX,
  CustomUserRank,
} from './entities/custom-user-rank.entity';
import { toCustomUserRankResponseDto } from './mappers/custom-user-rank.mapper';

// Owns CustomUserRank - a purely cosmetic, podglądowy ("preview") profile
// element, never a formal rank and never career history (see
// custom-user-rank.entity.ts / the module spec's naming rule). A true
// singleton: at most one row per user, so there is no `:id` in this
// service's surface at all - GET/PUT/DELETE all resolve "the caller's
// row" directly, same shape as FormalRankService's own current/setCurrent/
// endCurrent (see that service). Every method scopes its query by
// `user: user.id`/`userId`, which also makes "not mine" and "doesn't
// exist" indistinguishable - not that IDOR is even reachable here any
// more (there is no id parameter to target someone else's row with), but
// the scoping is kept anyway as the same defensive posture used
// throughout this module.
@Injectable()
export class CustomUserRankService {
  constructor(private readonly em: EntityManager) {}

  /**
   * A 404 (CUSTOM_RANK_NOT_SET) when the caller has no independent rank,
   * not a 200 with an empty body - same reasoning as
   * FormalRankService.getCurrent (NestJS's Express adapter cannot send a
   * literal JSON `null` root body).
   */
  async getCurrent(userId: string): Promise<CustomUserRankResponseDto> {
    const customRank = await this.findOwn(userId);
    if (!customRank) {
      throw this.notSet();
    }
    return toCustomUserRankResponseDto(
      customRank,
      customRank.cordSegments.getItems(),
    );
  }

  /**
   * Same lookup as getCurrent, but for callers where "not set" is an
   * ordinary, expected outcome rather than a 404 - e.g.
   * UserProfileService.getPublicProfile resolving another user's
   * independent rank for the public profile surface. Mirrors
   * FormalRankService.getCurrentOrNull's own reasoning exactly. Returns
   * the raw entity (not the DTO) so callers needing the underlying
   * cordSegments for their own mapping don't have to re-fetch it.
   */
  async getCurrentOrNull(userId: string): Promise<CustomUserRank | null> {
    return this.findOwn(userId);
  }

  /**
   * Upsert: updates the caller's existing row in place (full-replacing
   * `cordSegments`, same delete-then-insert convention as the old
   * `update()`) if one exists, otherwise creates a fresh one. There is no
   * separate create/update split any more - a singleton has no meaningful
   * distinction between "the first PUT" and "a later PUT".
   */
  async setCurrent(
    user: User,
    input: CreateCustomUserRankInput,
  ): Promise<CustomUserRankResponseDto> {
    return this.em.transactional(async (em) => {
      const existing = await this.findOwn(user.id, em);
      if (existing) {
        return this.replaceExisting(em, existing, input);
      }
      return this.createNew(em, user, input);
    });
  }

  /**
   * Physical delete, always allowed for the owner - a CustomUserRank is
   * never referenced by FormalRankAssignment (see that entity's own
   * comment: a custom cordão never becomes career history), so there is
   * nothing that could ever block this.
   */
  async deleteCurrent(user: User): Promise<void> {
    const customRank = await this.findOwn(user.id);
    if (!customRank) {
      throw this.notSet();
    }
    await this.em.remove(customRank).flush();
  }

  private async createNew(
    em: EntityManager,
    user: User,
    input: CreateCustomUserRankInput,
  ): Promise<CustomUserRankResponseDto> {
    const customRank = new CustomUserRank();
    customRank.user = user;
    customRank.name = input.name;
    customRank.description = input.description;
    customRank.track = input.track;

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
      // Concurrent-create race backstop - two concurrent first-time PUTs
      // from the same user would otherwise both try to insert a row,
      // transiently violating CUSTOM_USER_RANKS_USER_UNIQUE_INDEX. Same
      // pattern the old code used for its active-unique race (see the
      // module's git history) and the one FormalGroupAffiliation.
      // setFormalGroup/FormalRankService.setCurrent use for their own
      // active-unique races.
      if (isUniqueViolationOn(error, CUSTOM_USER_RANKS_USER_UNIQUE_INDEX)) {
        throw new ConflictException({
          code: 'CUSTOM_RANK_ALREADY_SET',
          message: 'A concurrent change already set your independent rank',
        });
      }
      throw error;
    }

    return toCustomUserRankResponseDto(customRank, segments);
  }

  private async replaceExisting(
    em: EntityManager,
    customRank: CustomUserRank,
    input: CreateCustomUserRankInput,
  ): Promise<CustomUserRankResponseDto> {
    customRank.name = input.name;
    customRank.description = input.description;
    customRank.track = input.track;

    // Delete-then-insert, in two flushes within this one transaction -
    // same reasoning as RanksService.update (a resubmitted segment
    // commonly reuses the same `position` values as the ones being
    // replaced).
    for (const segment of customRank.cordSegments.getItems()) {
      em.remove(segment);
    }
    await em.flush();

    const segments = buildCordSegments(
      () => new CustomUserRankCordSegment(),
      input.cordSegments,
    );
    for (const segment of segments) {
      segment.customRank = customRank;
    }

    await em.persist(segments).flush();
    return toCustomUserRankResponseDto(customRank, segments);
  }

  private async findOwn(
    userId: string,
    em: EntityManager = this.em,
  ): Promise<CustomUserRank | null> {
    return em.findOne(
      CustomUserRank,
      { user: userId },
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
