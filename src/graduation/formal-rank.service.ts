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
import { CustomUserRank } from './entities/custom-user-rank.entity';
import { Rank } from './entities/rank.entity';
import {
  FORMAL_RANK_ASSIGNMENTS_ACTIVE_UNIQUE_INDEX,
  FormalRankAssignment,
} from './entities/formal-rank-assignment.entity';
import { SetFormalRankInput } from './dto/set-formal-rank.schema';
import { FormalRankAssignmentResponseDto } from './dto/formal-rank-assignment-response.dto';
import { toFormalRankAssignmentResponseDto } from './mappers/formal-rank-assignment.mapper';

const RANK_POPULATE = ['rank.cordSegments', 'sourceGroup'] as const;

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
  constructor(private readonly em: EntityManager) {}

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

      // Selecting a formal Rank removes the active custom cordão from the
      // profile (see the module spec, rule 8) - deactivated, never
      // deleted, and never restored automatically later (rule 9).
      const activeCordao = await em.findOne(CustomUserRank, {
        user: user.id,
        isActive: true,
      });
      if (activeCordao) {
        activeCordao.isActive = false;
      }

      const assignment = new FormalRankAssignment();
      assignment.user = user;
      assignment.rank = rank;
      assignment.sourceGroup = formalGroup.group;
      assignment.startedOn = startedOn;
      assignment.awardedByName = input.awardedByName ?? null;

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
}
