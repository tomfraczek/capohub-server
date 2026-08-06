import { CordSegmentResponseDto } from '../dto/rank-response.dto';
import { CustomUserRankResponseDto } from '../dto/custom-user-rank-response.dto';
import { CustomUserRankCordSegment } from '../entities/custom-user-rank-cord-segment.entity';
import { CustomUserRank } from '../entities/custom-user-rank.entity';

function toCordSegmentResponseDto(
  segment: CustomUserRankCordSegment,
): CordSegmentResponseDto {
  return {
    position: segment.position,
    colorHex: segment.colorHex,
    proportion: segment.proportion,
  };
}

/**
 * `segments` is always passed explicitly - see the identical rationale on
 * rank.mapper.ts's toRankResponseDto.
 */
export function toCustomUserRankResponseDto(
  customRank: CustomUserRank,
  segments: CustomUserRankCordSegment[],
): CustomUserRankResponseDto {
  return {
    id: customRank.id,
    name: customRank.name,
    description: customRank.description,
    track: customRank.track,
    isActive: customRank.isActive,
    cordSegments: [...segments]
      .sort((a, b) => a.position - b.position)
      .map(toCordSegmentResponseDto),
    createdAt: customRank.createdAt.toISOString(),
    updatedAt: customRank.updatedAt.toISOString(),
  };
}
