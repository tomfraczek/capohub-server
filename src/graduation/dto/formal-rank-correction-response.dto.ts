import { RankTrack } from '../enums/rank-track.enum';
import { FormalRankCorrectionStatus } from '../enums/formal-rank-correction-status.enum';

// {id, displayName} only - never email/phone/clerkUserId/roles, matching
// MembershipRequestResponseDto's own minimal actor ref shape.
export interface CorrectionUserRefDto {
  id: string;
  displayName: string;
}

// Deliberately smaller than FormalRankRefDto (used by
// FormalRankAssignmentResponseDto) - this workflow's DTOs identify *which*
// Rank is current/proposed, they don't need to render its cord. A client
// wanting the full detail (cordSegments, description, isArchived) already
// has GET /groups/:groupId/ranks/:rankId for that.
export interface CorrectionRankRefDto {
  id: string;
  name: string;
  track: RankTrack;
}

export interface CorrectionSectionRefDto {
  id: string;
  name: string;
}

// GET/POST .../formal-rank-corrections (Section OWNER/ADMIN view) - never
// exposes email, phone, clerkUserId, or roles for either the target or
// any actor ref (see the module spec).
export interface FormalRankCorrectionResponseDto {
  id: string;
  section: CorrectionSectionRefDto;
  targetUser: CorrectionUserRefDto;
  formalRankAssignmentId: string;
  currentRank: CorrectionRankRefDto;
  proposedRank: CorrectionRankRefDto | null;
  status: FormalRankCorrectionStatus;
  reason: string | null;
  // `null` only when the reporter's account has since been deleted (see
  // the entity's `set null` FK policy) - the request itself is retained.
  reportedBy: CorrectionUserRefDto | null;
  submittedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: CorrectionUserRefDto | null;
  rejectionReason: string | null;
  createdAt: string;
}
