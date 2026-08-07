import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { EntityManager } from '@mikro-orm/postgresql';
import { AuditLogService } from '../groups/audit-log.service';
import { AuditAction } from '../groups/enums/audit-action.enum';
import { AuditTargetType } from '../groups/enums/audit-target-type.enum';
import { FormalGroupAffiliation } from '../groups/entities/formal-group-affiliation.entity';
import { User } from '../users/entities/user.entity';
import { buildCordSegments } from './cord-segment-builder';
import { CreateRankInput } from './dto/create-rank.schema';
import {
  FormalRankOptionDto,
  FormalRankOptionsByTrackDto,
  FormalRankOptionsResponseDto,
} from './dto/formal-rank-options-response.dto';
import {
  RankResponseDto,
  RanksByTrackResponseDto,
} from './dto/rank-response.dto';
import { UpdateRankInput } from './dto/update-rank.schema';
import { GraduationSystem } from './entities/graduation-system.entity';
import { RankCordSegment } from './entities/rank-cord-segment.entity';
import { Rank } from './entities/rank.entity';
import { RankTrack } from './enums/rank-track.enum';
import {
  toRankResponseDto,
  toRanksByTrackResponseDto,
} from './mappers/rank.mapper';
import { wouldCreateCycle } from './rank-chain';

// Group existence/status and that the caller is OWNER/ADMIN of *this exact
// Group* is already enforced by GroupPermissionsGuard before any handler
// here runs (see ranks.controller.ts) - this service owns the catalog's
// own invariants: which GraduationSystem a Rank belongs to, its position
// in the gradation chain, and its own lifecycle (archived/restored).
@Injectable()
export class RanksService {
  constructor(
    private readonly em: EntityManager,
    private readonly auditLogService: AuditLogService,
  ) {}

  async list(groupId: string): Promise<RanksByTrackResponseDto> {
    const system = await this.loadActiveSystem(this.em, groupId);
    if (!system) {
      return { [RankTrack.CHILD]: [], [RankTrack.ADULT]: [] };
    }

    const ranks = await this.em.find(
      Rank,
      { system: system.id },
      { populate: ['previousRank', 'cordSegments'] },
    );
    return toRanksByTrackResponseDto(ranks);
  }

  async getById(groupId: string, rankId: string): Promise<RankResponseDto> {
    const rank = await this.loadRank(this.em, groupId, rankId);
    const nextRankId = await this.findNextRankId(this.em, rank);
    return toRankResponseDto(rank, nextRankId, rank.cordSegments.getItems());
  }

  /**
   * GET /users/me/formal-rank-options - the self-service catalog read for
   * @CurrentUser(), never gated by GroupPermission.GRADUATION_SYSTEM_VIEW
   * (which only Group OWNER/ADMIN hold - see the module spec). Derives the
   * Group exclusively from the caller's own active FormalGroupAffiliation;
   * there is no groupId parameter here, so a caller can never inspect
   * another Group's catalog through this endpoint.
   *
   * Reuses toRanksByTrackResponseDto (the exact same orderChain-based
   * ordering `list()` above uses) rather than re-deriving gradation order.
   * Archived ranks are filtered out *after* ordering, not before: the
   * chain walk in orderChain needs every node present to follow
   * previousRank correctly - filtering first would silently truncate the
   * walk at the first archived gap (see rank-chain.ts). A previousRankId/
   * nextRankId that happens to point at a since-filtered archived rank is
   * left as-is (not re-linked) - a rare edge case, and out of scope for
   * this read-only selector.
   */
  async getFormalRankOptionsForUser(
    userId: string,
  ): Promise<FormalRankOptionsResponseDto> {
    const formalGroup = await this.loadActiveFormalGroupAffiliation(
      this.em,
      userId,
    );
    if (!formalGroup) {
      return {
        formalGroup: null,
        graduationSystem: null,
        ranks: this.emptyRankOptionsByTrack(),
      };
    }

    const system = await this.loadActiveSystem(this.em, formalGroup.group.id);
    const formalGroupRef = {
      id: formalGroup.group.id,
      name: formalGroup.group.name,
    };
    if (!system) {
      return {
        formalGroup: formalGroupRef,
        graduationSystem: null,
        ranks: this.emptyRankOptionsByTrack(),
      };
    }

    const ranks = await this.em.find(
      Rank,
      { system: system.id },
      { populate: ['previousRank', 'cordSegments'] },
    );
    const byTrack = toRanksByTrackResponseDto(ranks);

    return {
      formalGroup: formalGroupRef,
      graduationSystem: { id: system.id, name: system.name },
      ranks: {
        [RankTrack.CHILD]: this.toFormalRankOptions(byTrack[RankTrack.CHILD]),
        [RankTrack.ADULT]: this.toFormalRankOptions(byTrack[RankTrack.ADULT]),
      },
    };
  }

  private toFormalRankOptions(ranks: RankResponseDto[]): FormalRankOptionDto[] {
    return ranks
      .filter((rank) => !rank.isArchived)
      .map((rank) => ({
        id: rank.id,
        name: rank.name,
        description: rank.description,
        track: rank.track,
        previousRankId: rank.previousRankId,
        nextRankId: rank.nextRankId,
        cordSegments: rank.cordSegments,
      }));
  }

  private emptyRankOptionsByTrack(): FormalRankOptionsByTrackDto {
    return { [RankTrack.CHILD]: [], [RankTrack.ADULT]: [] };
  }

  // Same query shape as FormalRankService/FormalRankCorrectionService's own
  // private loadActiveFormalGroup - deliberately re-implemented here rather
  // than shared/extracted (see the module's own established convention of
  // one small private copy per consumer, not a shared helper).
  private async loadActiveFormalGroupAffiliation(
    em: EntityManager,
    userId: string,
  ): Promise<FormalGroupAffiliation | null> {
    return em.findOne(
      FormalGroupAffiliation,
      { user: userId, endedOn: null },
      { populate: ['group'] },
    );
  }

  async create(
    groupId: string,
    input: CreateRankInput,
    actor: User,
  ): Promise<RankResponseDto> {
    return this.em.transactional(async (em) => {
      const system = await this.loadActiveSystem(em, groupId);
      if (!system) {
        throw this.systemNotFound();
      }

      const previousRank = await this.resolveAndValidatePreviousRank(
        em,
        system,
        input.track,
        input.previousRankId,
        null,
      );

      const rank = new Rank();
      rank.system = system;
      rank.track = input.track;
      rank.name = input.name;
      rank.description = input.description;
      rank.previousRank = previousRank;

      const segments = buildCordSegments(
        () => new RankCordSegment(),
        input.cordSegments,
      );
      for (const segment of segments) {
        segment.rank = rank;
      }

      this.auditLogService.record(em, {
        community: system.group,
        action: AuditAction.CREATE_RANK,
        actor,
        targetType: AuditTargetType.RANK,
        targetId: rank.id,
      });

      await em.persist([rank, ...segments]).flush();

      // A brand-new rank can never already have a successor pointing to it.
      return toRankResponseDto(rank, null, segments);
    });
  }

  async update(
    groupId: string,
    rankId: string,
    input: UpdateRankInput,
    actor: User,
  ): Promise<RankResponseDto> {
    return this.em.transactional(async (em) => {
      const rank = await this.loadRank(em, groupId, rankId);
      const system = rank.system;

      if (input.track !== rank.track) {
        const successorCount = await em.count(Rank, { previousRank: rank.id });
        if (successorCount > 0) {
          throw new ConflictException({
            code: 'RANK_TRACK_CHANGE_BLOCKED_BY_SUCCESSOR',
            message:
              'Cannot change track while another rank points to this one as its previous rank',
          });
        }
      }

      const previousRank = await this.resolveAndValidatePreviousRank(
        em,
        system,
        input.track,
        input.previousRankId,
        rank.id,
      );
      const previousRankIdChanged =
        (rank.previousRank?.id ?? null) !== (previousRank?.id ?? null);

      rank.name = input.name;
      rank.description = input.description;
      rank.track = input.track;
      rank.previousRank = previousRank;

      // Delete-then-insert, in two flushes within this one transaction -
      // never a single flush, and never outside a transaction. A
      // resubmitted segment commonly reuses the same `position` values as
      // the ones being replaced (e.g. an edit that only changes the
      // description), so inserting the new rows before the old ones are
      // actually gone would transiently violate the (rank_id, position)
      // unique index. Same ordering hazard, and same fix, as
      // UserProfileService.setFormalGroup's end-then-insert sequencing.
      for (const segment of rank.cordSegments.getItems()) {
        em.remove(segment);
      }
      await em.flush();

      const segments = buildCordSegments(
        () => new RankCordSegment(),
        input.cordSegments,
      );
      for (const segment of segments) {
        segment.rank = rank;
      }

      if (previousRankIdChanged) {
        this.auditLogService.record(em, {
          community: system.group,
          action: AuditAction.REORDER_RANK,
          actor,
          targetType: AuditTargetType.RANK,
          targetId: rank.id,
        });
      }
      this.auditLogService.record(em, {
        community: system.group,
        action: AuditAction.UPDATE_RANK,
        actor,
        targetType: AuditTargetType.RANK,
        targetId: rank.id,
      });

      await em.persist(segments).flush();

      const nextRankId = await this.findNextRankId(em, rank);
      return toRankResponseDto(rank, nextRankId, segments);
    });
  }

  async archive(
    groupId: string,
    rankId: string,
    actor: User,
  ): Promise<RankResponseDto> {
    const rank = await this.loadRank(this.em, groupId, rankId);
    if (rank.isArchived) {
      throw new ConflictException({
        code: 'RANK_ALREADY_ARCHIVED',
        message: 'This rank is already archived',
      });
    }
    rank.isArchived = true;

    this.auditLogService.record(this.em, {
      community: rank.system.group,
      action: AuditAction.ARCHIVE_RANK,
      actor,
      targetType: AuditTargetType.RANK,
      targetId: rank.id,
    });

    await this.em.flush();
    const nextRankId = await this.findNextRankId(this.em, rank);
    return toRankResponseDto(rank, nextRankId, rank.cordSegments.getItems());
  }

  async restore(
    groupId: string,
    rankId: string,
    actor: User,
  ): Promise<RankResponseDto> {
    const rank = await this.loadRank(this.em, groupId, rankId);
    if (!rank.isArchived) {
      throw new ConflictException({
        code: 'RANK_NOT_ARCHIVED',
        message: 'This rank is not archived',
      });
    }
    rank.isArchived = false;

    this.auditLogService.record(this.em, {
      community: rank.system.group,
      action: AuditAction.RESTORE_RANK,
      actor,
      targetType: AuditTargetType.RANK,
      targetId: rank.id,
    });

    await this.em.flush();
    const nextRankId = await this.findNextRankId(this.em, rank);
    return toRankResponseDto(rank, nextRankId, rank.cordSegments.getItems());
  }

  /**
   * Validates and resolves a candidate `previousRankId` against every rule
   * in the module spec that spans more than the single Rank row being
   * written (same system, same track, no self-reference, no cycle, at
   * most one direct successor per rank, at most one first rank per
   * system+track) - none of these are expressible as a single-row DB
   * CHECK, so they live here, backstopped by the partial unique indexes
   * on the entity for the two "at most one" rules (see rank.entity.ts).
   * `currentRankId` is null when validating a brand-new rank (create),
   * or the rank's own id when validating a move (update) - see
   * rank-chain.ts.wouldCreateCycle.
   */
  private async resolveAndValidatePreviousRank(
    em: EntityManager,
    system: GraduationSystem,
    track: RankTrack,
    previousRankId: string | null,
    currentRankId: string | null,
  ): Promise<Rank | null> {
    if (previousRankId === null) {
      const existingFirst = await em.findOne(Rank, {
        system: system.id,
        track,
        previousRank: null,
        ...(currentRankId ? { id: { $ne: currentRankId } } : {}),
      });
      if (existingFirst) {
        throw new ConflictException({
          code: 'RANK_FIRST_ALREADY_EXISTS',
          message: 'This track already has a first rank',
        });
      }
      return null;
    }

    const candidate = await em.findOne(Rank, {
      id: previousRankId,
      system: system.id,
    });
    if (!candidate) {
      throw new ConflictException({
        code: 'RANK_PREVIOUS_RANK_INVALID',
        message: 'previousRank must belong to the same graduation system',
      });
    }
    if (candidate.track !== track) {
      throw new ConflictException({
        code: 'RANK_PREVIOUS_RANK_TRACK_MISMATCH',
        message: 'previousRank must belong to the same track',
      });
    }
    if (currentRankId && candidate.id === currentRankId) {
      throw new ConflictException({
        code: 'RANK_SELF_REFERENCE',
        message: 'A rank cannot be its own previous rank',
      });
    }

    const trackRanks = await em.find(Rank, { system: system.id, track });
    const previousRankIdById = new Map(
      trackRanks.map((r) => [r.id, r.previousRank?.id ?? null]),
    );
    if (wouldCreateCycle(currentRankId, candidate.id, previousRankIdById)) {
      throw new ConflictException({
        code: 'RANK_CYCLE',
        message: 'This would create a cycle in the gradation chain',
      });
    }

    const existingSuccessor = await em.findOne(Rank, {
      previousRank: candidate.id,
      ...(currentRankId ? { id: { $ne: currentRankId } } : {}),
    });
    if (existingSuccessor) {
      throw new ConflictException({
        code: 'RANK_PREVIOUS_ALREADY_HAS_SUCCESSOR',
        message: 'This rank already has a direct successor',
      });
    }

    return candidate;
  }

  private async loadActiveSystem(
    em: EntityManager,
    groupId: string,
  ): Promise<GraduationSystem | null> {
    return em.findOne(
      GraduationSystem,
      { group: groupId, isActive: true },
      { populate: ['group'] },
    );
  }

  private async loadRank(
    em: EntityManager,
    groupId: string,
    rankId: string,
  ): Promise<Rank> {
    const rank = await em.findOne(
      Rank,
      { id: rankId, system: { group: groupId, isActive: true } },
      { populate: ['previousRank', 'cordSegments', 'system.group'] },
    );
    if (!rank) {
      throw this.rankNotFound();
    }
    return rank;
  }

  private async findNextRankId(
    em: EntityManager,
    rank: Rank,
  ): Promise<string | null> {
    const next = await em.findOne(Rank, { previousRank: rank.id });
    return next?.id ?? null;
  }

  private systemNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'GRADUATION_SYSTEM_NOT_FOUND',
      message: 'This group has no active graduation system',
    });
  }

  private rankNotFound(): NotFoundException {
    return new NotFoundException({
      code: 'RANK_NOT_FOUND',
      message: 'Rank not found',
    });
  }
}
