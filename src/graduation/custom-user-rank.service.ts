import {
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
import { UpdateCustomUserRankInput } from './dto/update-custom-user-rank.schema';
import { CustomUserRankCordSegment } from './entities/custom-user-rank-cord-segment.entity';
import {
  CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX,
  CustomUserRank,
} from './entities/custom-user-rank.entity';
import { toCustomUserRankResponseDto } from './mappers/custom-user-rank.mapper';

// Owns CustomUserRank - a purely cosmetic, podglądowy ("preview") profile
// element, never a formal rank and never career history (see
// custom-user-rank.entity.ts / the module spec's naming rule). Creating,
// editing and deleting are always available to the owner regardless of
// FormalGroupAffiliation status - only *activating* one (making it the
// cordão shown on the profile) is gated, since that is the one action
// that would otherwise let a user display a self-declared cordão
// alongside/instead of a real formal rank (see `activate`). Every method
// below scopes its query by `user: user.id`, which also makes "not mine"
// and "doesn't exist" indistinguishable - see the module spec's IDOR
// requirement.
@Injectable()
export class CustomUserRankService {
  constructor(private readonly em: EntityManager) {}

  async create(
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

    await this.em.persist([customRank, ...segments]).flush();
    return toCustomUserRankResponseDto(customRank, segments);
  }

  async list(user: User): Promise<CustomUserRankResponseDto[]> {
    const customRanks = await this.em.find(
      CustomUserRank,
      { user: user.id },
      { populate: ['cordSegments'], orderBy: { createdAt: 'desc' } },
    );
    return customRanks.map((customRank) =>
      toCustomUserRankResponseDto(
        customRank,
        customRank.cordSegments.getItems(),
      ),
    );
  }

  async getById(user: User, id: string): Promise<CustomUserRankResponseDto> {
    const customRank = await this.loadOwn(user.id, id);
    return toCustomUserRankResponseDto(
      customRank,
      customRank.cordSegments.getItems(),
    );
  }

  async update(
    user: User,
    id: string,
    input: UpdateCustomUserRankInput,
  ): Promise<CustomUserRankResponseDto> {
    return this.em.transactional(async (em) => {
      const customRank = await this.loadOwn(user.id, id, em);

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
    });
  }

  /**
   * Sets this CustomUserRank as the one shown on the caller's profile,
   * deactivating whichever was active before (if any) - never allowed
   * while an active FormalGroupAffiliation exists (see the module spec,
   * rule 7). The reverse direction - a formal Rank selection deactivating
   * an active cordão - lives in FormalRankService.setCurrent, not here.
   */
  async activate(user: User, id: string): Promise<CustomUserRankResponseDto> {
    return this.em.transactional(async (em) => {
      const formalGroup = await em.findOne(FormalGroupAffiliation, {
        user: user.id,
        endedOn: null,
      });
      if (formalGroup) {
        throw new ConflictException({
          code: 'CUSTOM_RANK_REQUIRES_NO_FORMAL_GROUP',
          message:
            'A custom cordão cannot be set active while you have an active formal group affiliation',
        });
      }

      const customRank = await this.loadOwn(user.id, id, em);
      if (customRank.isActive) {
        return toCustomUserRankResponseDto(
          customRank,
          customRank.cordSegments.getItems(),
        );
      }

      const currentlyActive = await em.findOne(CustomUserRank, {
        user: user.id,
        isActive: true,
      });
      if (currentlyActive) {
        currentlyActive.isActive = false;
        // Flushed before the new one is activated below - same
        // insert-before-update transient-unique-violation hazard as
        // FormalGroupAffiliation.setFormalGroup.
        await em.flush();
      }

      customRank.isActive = true;
      try {
        await em.flush();
      } catch (error) {
        if (isUniqueViolationOn(error, CUSTOM_USER_RANKS_ACTIVE_UNIQUE_INDEX)) {
          throw new ConflictException({
            code: 'CUSTOM_RANK_ALREADY_ACTIVE',
            message:
              'A concurrent change already activated a different custom cordão',
          });
        }
        throw error;
      }

      return toCustomUserRankResponseDto(
        customRank,
        customRank.cordSegments.getItems(),
      );
    });
  }

  /** Idempotent - clears `isActive` regardless of its prior value. */
  async deactivate(user: User, id: string): Promise<CustomUserRankResponseDto> {
    const customRank = await this.loadOwn(user.id, id);
    customRank.isActive = false;
    await this.em.flush();
    return toCustomUserRankResponseDto(
      customRank,
      customRank.cordSegments.getItems(),
    );
  }

  /**
   * Physical delete, always allowed for the owner - a CustomUserRank is
   * never referenced by FormalRankAssignment (see that entity's own
   * comment: a custom cordão never becomes career history), so there is
   * nothing that could ever block this.
   */
  async delete(user: User, id: string): Promise<void> {
    const customRank = await this.loadOwn(user.id, id);
    await this.em.remove(customRank).flush();
  }

  private async loadOwn(
    userId: string,
    id: string,
    em: EntityManager = this.em,
  ): Promise<CustomUserRank> {
    const customRank = await em.findOne(
      CustomUserRank,
      { id, user: userId },
      { populate: ['cordSegments'] },
    );
    if (!customRank) {
      throw new NotFoundException({
        code: 'CUSTOM_RANK_NOT_FOUND',
        message: 'Custom rank not found',
      });
    }
    return customRank;
  }
}
