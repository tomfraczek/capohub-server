import {
  CordSegmentResponseDto,
  RankResponseDto,
  RanksByTrackResponseDto,
} from '../dto/rank-response.dto';
import { RankCordSegment } from '../entities/rank-cord-segment.entity';
import { Rank } from '../entities/rank.entity';
import { RankTrack } from '../enums/rank-track.enum';
import { buildNextIdById, orderChain } from '../rank-chain';

export function toCordSegmentResponseDto(
  segment: RankCordSegment,
): CordSegmentResponseDto {
  return {
    position: segment.position,
    colorHex: segment.colorHex,
    proportion: segment.proportion,
  };
}

function toSortedCordSegmentDtos(
  segments: RankCordSegment[],
): CordSegmentResponseDto[] {
  return [...segments]
    .sort((a, b) => a.position - b.position)
    .map(toCordSegmentResponseDto);
}

/**
 * `segments` is always passed explicitly rather than read from
 * `rank.cordSegments` here - RanksService.create/update build a fresh
 * segment array in memory (never populated from the DB, since the rows
 * don't exist yet at that point in the request), so relying on the
 * Collection would require initializing it via a mutating call like
 * `.set()`, which needs MikroORM's metadata storage to be bootstrapped
 * (fine at runtime, but an unnecessary dependency for unit tests and for
 * this function's own purity). Read paths (list/getById) simply pass
 * `rank.cordSegments.getItems()`, which is populated from the DB.
 */
export function toRankResponseDto(
  rank: Rank,
  nextRankId: string | null,
  segments: RankCordSegment[],
): RankResponseDto {
  return {
    id: rank.id,
    track: rank.track,
    name: rank.name,
    nameFemale: rank.nameFemale,
    description: rank.description,
    previousRankId: rank.previousRank?.id ?? null,
    nextRankId,
    isArchived: rank.isArchived,
    cordSegments: toSortedCordSegmentDtos(segments),
    createdAt: rank.createdAt.toISOString(),
    updatedAt: rank.updatedAt.toISOString(),
  };
}

/**
 * Groups `ranks` by track and orders each track's list purely by walking
 * its `previousRank` chain (see rank-chain.ts) - never alphabetically or
 * by createdAt, per the module spec.
 */
export function toRanksByTrackResponseDto(
  ranks: Rank[],
): RanksByTrackResponseDto {
  const result: RanksByTrackResponseDto = {
    [RankTrack.CHILD]: [],
    [RankTrack.ADULT]: [],
  };

  for (const track of [RankTrack.CHILD, RankTrack.ADULT]) {
    const tracked = ranks.filter((rank) => rank.track === track);
    const nodes = tracked.map((rank) => ({
      id: rank.id,
      previousRankId: rank.previousRank?.id ?? null,
    }));
    const nextIdById = buildNextIdById(nodes);
    const orderedIds = orderChain(nodes).map((node) => node.id);
    const rankById = new Map(tracked.map((rank) => [rank.id, rank]));

    result[track] = orderedIds.map((id) => {
      const rank = rankById.get(id)!;
      return toRankResponseDto(
        rank,
        nextIdById.get(id) ?? null,
        rank.cordSegments.getItems(),
      );
    });
  }

  return result;
}
