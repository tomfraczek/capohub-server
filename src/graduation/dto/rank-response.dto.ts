import { RankTrack } from '../enums/rank-track.enum';

export interface CordSegmentResponseDto {
  position: number;
  colorHex: string;
  proportion: number;
}

// No `sortOrder` - see rank.entity.ts. `nextRankId` is always computed by
// walking the chain (see rank-chain.ts), never stored.
export interface RankResponseDto {
  id: string;
  track: RankTrack;
  // Masculine/default form; nameFemale is null only on a legacy rank that
  // hasn't been edited since (see rank.entity.ts).
  name: string;
  nameFemale: string | null;
  description: string | null;
  previousRankId: string | null;
  nextRankId: string | null;
  isArchived: boolean;
  cordSegments: CordSegmentResponseDto[];
  createdAt: string;
  updatedAt: string;
}

// GET /groups/:groupId/ranks - the two tracks returned separately, each
// already in gradation order (see rank-chain.ts) - never sorted
// alphabetically or by createdAt.
export interface RanksByTrackResponseDto {
  [RankTrack.CHILD]: RankResponseDto[];
  [RankTrack.ADULT]: RankResponseDto[];
}
