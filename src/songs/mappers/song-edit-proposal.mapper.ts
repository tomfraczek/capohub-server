import { SongEditProposalResponseDto } from '../dto/song-edit-proposal-response.dto';
import { SongEditProposal } from '../entities/song-edit-proposal.entity';
import { toSongUserRefDto } from './song.mapper';

// `proposal.proposedBy`/`reviewedBy` must be populated by the caller before
// this runs (toSongUserRefDto reads .displayName, which an unpopulated
// MikroORM reference does not carry) - see SongEditProposalsService's own
// populate lists.
export function toSongEditProposalResponseDto(
  proposal: SongEditProposal,
): SongEditProposalResponseDto {
  return {
    id: proposal.id,
    songId: proposal.song.id,
    proposedBy: toSongUserRefDto(proposal.proposedBy),
    status: proposal.status,
    payload: proposal.payload,
    rejectionReason: proposal.rejectionReason,
    reviewedBy: toSongUserRefDto(proposal.reviewedBy),
    reviewedAt: proposal.reviewedAt ? proposal.reviewedAt.toISOString() : null,
    createdAt: proposal.createdAt.toISOString(),
    updatedAt: proposal.updatedAt.toISOString(),
  };
}
