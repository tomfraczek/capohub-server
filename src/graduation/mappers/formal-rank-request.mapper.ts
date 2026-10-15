import { CordSegmentResponseDto } from '../dto/rank-response.dto';
import {
  FormalRankRequestRankDto,
  OwnFormalRankRequestResponseDto,
} from '../dto/formal-rank-request-response.dto';
import { FormalRankRequest } from '../entities/formal-rank-request.entity';
import { UserGender } from '../../users/enums/user-gender.enum';
import { Rank } from '../entities/rank.entity';
import { resolveRankName } from '../rank-name.util';

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

// Requires `rank.cordSegments` to be populated. `holderGender` is the
// requester's - the rank is theirs, whoever is looking (rank-name.util.ts).
export function toFormalRankRequestRankDto(
  rank: Rank,
  holderGender: UserGender | null,
): FormalRankRequestRankDto {
  return {
    id: rank.id,
    name: resolveRankName(rank, holderGender),
    track: rank.track,
    cordSegments: toSortedSegments(rank.cordSegments.getItems()),
  };
}

// Requires `user`, `group` and `rank.cordSegments` to be populated.
export function toOwnFormalRankRequestResponseDto(
  request: FormalRankRequest,
): OwnFormalRankRequestResponseDto {
  return {
    id: request.id,
    status: request.status,
    group: { id: request.group.id, name: request.group.name },
    rank: toFormalRankRequestRankDto(request.rank, request.user.gender),
    startedOn: toDateOnly(request.startedOn),
    awardedByName: request.awardedByName,
    createdAt: request.createdAt.toISOString(),
  };
}
