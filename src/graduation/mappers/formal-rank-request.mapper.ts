import { CordSegmentResponseDto } from '../dto/rank-response.dto';
import {
  FormalRankRequestRankDto,
  OwnFormalRankRequestResponseDto,
} from '../dto/formal-rank-request-response.dto';
import { FormalRankRequest } from '../entities/formal-rank-request.entity';
import { Rank } from '../entities/rank.entity';

// Same 'date'-column normalization as formal-rank-assignment.mapper.ts.
export function toDateOnly(date: Date | string | null): string | null {
  if (!date) {
    return null;
  }
  return typeof date === 'string' ? date : date.toISOString().slice(0, 10);
}

export function toSortedSegments(
  segments: { position: number; colorHex: string; proportion: number }[],
): CordSegmentResponseDto[] {
  return [...segments]
    .sort((a, b) => a.position - b.position)
    .map(({ position, colorHex, proportion }) => ({
      position,
      colorHex,
      proportion,
    }));
}

// Requires `rank.cordSegments` to be populated.
export function toFormalRankRequestRankDto(
  rank: Rank,
): FormalRankRequestRankDto {
  return {
    id: rank.id,
    name: rank.name,
    track: rank.track,
    cordSegments: toSortedSegments(rank.cordSegments.getItems()),
  };
}

// Requires `group` and `rank.cordSegments` to be populated.
export function toOwnFormalRankRequestResponseDto(
  request: FormalRankRequest,
): OwnFormalRankRequestResponseDto {
  return {
    id: request.id,
    status: request.status,
    group: { id: request.group.id, name: request.group.name },
    rank: toFormalRankRequestRankDto(request.rank),
    startedOn: toDateOnly(request.startedOn),
    awardedByName: request.awardedByName,
    createdAt: request.createdAt.toISOString(),
  };
}
