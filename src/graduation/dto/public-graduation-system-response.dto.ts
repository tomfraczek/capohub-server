import { RankTrack } from '../enums/rank-track.enum';
import { CordSegmentResponseDto } from './rank-response.dto';

// Public read model of one rank - only what a viewer needs to see the
// Group's gradation: no isArchived (archived ranks are filtered out before
// this DTO is built - see RanksService.listPublic), no previousRankId/
// nextRankId (the array order already IS the gradation order) and no
// createdAt/updatedAt (administrative bookkeeping).
export interface PublicRankDto {
  id: string;
  // Both forms - a catalog read isn't about any one holder (see
  // rank-name.util.ts); nameFemale null on a not-yet-edited legacy rank.
  name: string;
  nameFemale: string | null;
  description: string | null;
  cordSegments: CordSegmentResponseDto[];
}

// GET /groups/:groupId/graduation-system/public - the Group's catalog as
// shown on its public profile, gated only by GROUP_VIEW (anyone who can see
// the Group's profile), never by GRADUATION_SYSTEM_VIEW. Both tracks are
// always present; a Group without an active GraduationSystem (or with only
// archived ranks) simply returns two empty tracks - a valid, non-error
// state, never a 404.
export interface PublicGraduationSystemResponseDto {
  [RankTrack.CHILD]: PublicRankDto[];
  [RankTrack.ADULT]: PublicRankDto[];
}
