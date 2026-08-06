import { RankTrack } from '../enums/rank-track.enum';
import { CordSegmentResponseDto } from './rank-response.dto';

// A custom cordão is never a formal rank and never career history (see
// custom-user-rank.entity.ts) - `isActive` only ever means "currently
// shown on this profile", never "currently held/earned".
export interface CustomUserRankResponseDto {
  id: string;
  name: string;
  description: string | null;
  track: RankTrack;
  isActive: boolean;
  cordSegments: CordSegmentResponseDto[];
  createdAt: string;
  updatedAt: string;
}
