import { RankTrack } from '../enums/rank-track.enum';
import { CordSegmentResponseDto } from './rank-response.dto';

// Self-service selector option - deliberately smaller than RankResponseDto
// (used by the admin catalog, GET /groups/:groupId/ranks): no `isArchived`
// (archived ranks are filtered out before this DTO is built - see
// RanksService.getFormalRankOptionsForUser) and no
// createdAt/updatedAt (administrative bookkeeping, not needed to pick a
// rank).
export interface FormalRankOptionDto {
  id: string;
  // Both forms - the picker shows the one matching whoever the rank is
  // being chosen for (see rank-name.util.ts).
  name: string;
  nameFemale: string | null;
  description: string | null;
  track: RankTrack;
  previousRankId: string | null;
  nextRankId: string | null;
  cordSegments: CordSegmentResponseDto[];
}

export interface FormalRankOptionsByTrackDto {
  [RankTrack.CHILD]: FormalRankOptionDto[];
  [RankTrack.ADULT]: FormalRankOptionDto[];
}

// GET /users/me/formal-rank-options - the self-service catalog a user
// picks their own formal rank from (via PUT /users/me/formal-rank or
// POST .../formal-rank-correction/submit), without ever needing
// GroupPermission.GRADUATION_SYSTEM_VIEW (see the module spec). `null`
// formalGroup/graduationSystem are valid, non-error states (no formal
// group set yet, or the group's catalog has no active graduation system)
// - the selector simply has nothing to offer yet.
export interface FormalRankOptionsResponseDto {
  formalGroup: { id: string; name: string } | null;
  graduationSystem: { id: string } | null;
  ranks: FormalRankOptionsByTrackDto;
  // true when the caller is their formal Group's OWNER/ADMIN: choosing a
  // rank here (PUT /users/me/formal-rank) is saved at once (200), never
  // sent for confirmation (202) - see graduation/own-rank-confirmation.ts,
  // the same rule the PUT applies. Always false without a formal Group.
  confirmsOwnRankImmediately: boolean;
}
