import { User } from '../../users/entities/user.entity';
import {
  CorrectionRankRefDto,
  CorrectionUserRefDto,
  FormalRankCorrectionResponseDto,
} from '../dto/formal-rank-correction-response.dto';
import { FormalRankCorrectionOwnResponseDto } from '../dto/formal-rank-correction-own-response.dto';
import { FormalRankCorrectionRequest } from '../entities/formal-rank-correction-request.entity';
import { Rank } from '../entities/rank.entity';
import { resolveDisplayName } from '../../users/display-name.util';

function toCorrectionUserRefDto(
  user: User | null,
): CorrectionUserRefDto | null {
  return user
    ? {
        id: user.id,
        displayName: resolveDisplayName(user),
        gender: user.gender,
      }
    : null;
}

function toCorrectionRankRefDto(rank: Rank): CorrectionRankRefDto {
  return { id: rank.id, name: rank.name, track: rank.track };
}

/**
 * `currentRank` is passed explicitly - the request only stores a
 * reference to the FormalRankAssignment, not the Rank itself, so the
 * caller resolves `request.formalRankAssignment.rank` (or a fresher
 * re-fetched Rank, at approve time) before mapping.
 */
export function toFormalRankCorrectionResponseDto(
  request: FormalRankCorrectionRequest,
  currentRank: Rank,
): FormalRankCorrectionResponseDto {
  return {
    id: request.id,
    section: { id: request.section.id, name: request.section.name },
    targetUser: {
      id: request.targetUser.id,
      displayName: resolveDisplayName(request.targetUser),
      gender: request.targetUser.gender,
    },
    formalRankAssignmentId: request.formalRankAssignment.id,
    currentRank: toCorrectionRankRefDto(currentRank),
    proposedRank: request.submittedRank
      ? toCorrectionRankRefDto(request.submittedRank)
      : null,
    status: request.status,
    reason: request.reason,
    reportedBy: toCorrectionUserRefDto(request.reportedBy),
    submittedAt: request.submittedAt ? request.submittedAt.toISOString() : null,
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
    reviewedBy: toCorrectionUserRefDto(request.reviewedBy),
    rejectionReason: request.rejectionReason,
    createdAt: request.createdAt.toISOString(),
  };
}

export function toFormalRankCorrectionOwnResponseDto(
  request: FormalRankCorrectionRequest,
  currentRank: Rank,
  catalogGroupId: string,
): FormalRankCorrectionOwnResponseDto {
  return {
    id: request.id,
    section: { id: request.section.id, name: request.section.name },
    status: request.status,
    reason: request.reason,
    reportedBy: toCorrectionUserRefDto(request.reportedBy),
    currentRank: toCorrectionRankRefDto(currentRank),
    proposedRank: request.submittedRank
      ? toCorrectionRankRefDto(request.submittedRank)
      : null,
    catalogGroupId,
    submittedAt: request.submittedAt ? request.submittedAt.toISOString() : null,
    reviewedAt: request.reviewedAt ? request.reviewedAt.toISOString() : null,
    reviewedBy: toCorrectionUserRefDto(request.reviewedBy),
    rejectionReason: request.rejectionReason,
  };
}
