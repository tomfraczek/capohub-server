import { GroupUserRefDto } from '../../groups/dto/group-user-ref.dto';
import { FormalRankCorrectionStatus } from '../enums/formal-rank-correction-status.enum';
import { RankTrack } from '../enums/rank-track.enum';
import {
  FormalRankEventRefDto,
  FormalRankRefDto,
  FormalRankSourceGroupRefDto,
} from './formal-rank-assignment-response.dto';

export interface SectionMemberFormalRankGroupRefDto {
  id: string;
  name: string;
}

// Same fields as FormalRankAssignmentResponseDto minus `endedOn`/
// `isCurrent` - this endpoint only ever resolves the target's *current*
// assignment, so both would always be `null`/`true` and add nothing.
export interface SectionMemberCurrentFormalRankDto {
  assignmentId: string;
  rank: FormalRankRefDto;
  sourceGroup: FormalRankSourceGroupRefDto;
  startedOn: string | null;
  awardedByName: string | null;
  event: FormalRankEventRefDto | null;
}

export interface SectionMemberFormalRankCorrectionRankRefDto {
  id: string;
  name: string;
  track: RankTrack;
}

// Minimal current state of an active FormalRankCorrectionRequest for this
// member - only ever present when one exists (module spec: at most one
// active request per FormalRankAssignment). Full detail (reason,
// reportedBy, reviewedBy, rejectionReason, ...) is still only available
// via GET sections/:sectionId/formal-rank-corrections/:requestId.
export interface SectionMemberFormalRankCorrectionStateDto {
  id: string;
  status: FormalRankCorrectionStatus;
  proposedRank: SectionMemberFormalRankCorrectionRankRefDto | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

// GET sections/:sectionId/members/:membershipId/formal-rank - Section
// OWNER/ADMIN-only prep view for the formal-rank-correction workflow (see
// the module spec). Never exposes email, phone, clerkUserId, other
// memberships, or roles - same minimal-ref convention as
// FormalRankCorrectionResponseDto.
export interface SectionMemberFormalRankResponseDto {
  user: GroupUserRefDto;
  formalGroup: SectionMemberFormalRankGroupRefDto | null;
  formalRank: SectionMemberCurrentFormalRankDto | null;
  correction: SectionMemberFormalRankCorrectionStateDto | null;
}
