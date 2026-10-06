import { RankTrack } from '../enums/rank-track.enum';
import { CordSegmentResponseDto } from './rank-response.dto';

// A custom cordão is never a formal rank and never career history (see
// custom-user-rank.entity.ts). No `isActive` any more - GET
// /users/me/custom-rank simply 404s (CUSTOM_RANK_NOT_SET) when the caller
// has none, same shape as FormalRankAssignmentResponseDto's "not set"
// handling.
export interface CustomUserRankResponseDto {
  id: string;
  name: string;
  description: string | null;
  track: RankTrack;
  cordSegments: CordSegmentResponseDto[];
  startedOn: string | null;
  createdAt: string;
  updatedAt: string;
}
