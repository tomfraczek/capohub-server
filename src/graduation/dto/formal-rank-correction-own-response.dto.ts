import { FormalRankCorrectionStatus } from '../enums/formal-rank-correction-status.enum';
import {
  CorrectionRankRefDto,
  CorrectionSectionRefDto,
  CorrectionUserRefDto,
} from './formal-rank-correction-response.dto';

// GET /users/me/formal-rank-correction - the target's own view of their
// active correction workflow (see the module spec, rule 3: "Właściciel
// profilu nadal widzi..."). Unlike the Section admin view, this never
// needs a `targetUser` ref (the caller already knows who they are) and
// additionally carries `catalogGroupId` so the client can fetch the
// ordered, selectable Rank list from the existing catalog endpoint (GET
// /groups/:groupId/ranks) rather than this DTO re-deriving/duplicating
// that list.
export interface FormalRankCorrectionOwnResponseDto {
  id: string;
  section: CorrectionSectionRefDto;
  status: FormalRankCorrectionStatus;
  reason: string | null;
  reportedBy: CorrectionUserRefDto | null;
  // The formal rank currently on record - still the real, unmodified
  // FormalRankAssignment.rank; only *other* viewers have it hidden while
  // a correction is active (see FormalRankCorrectionService.isPubliclyVisible).
  currentRank: CorrectionRankRefDto;
  proposedRank: CorrectionRankRefDto | null;
  // The Group whose catalog the caller must pick `rankId` from when
  // submitting - see GET /groups/:groupId/ranks.
  catalogGroupId: string;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: CorrectionUserRefDto | null;
  rejectionReason: string | null;
}
