import { CreateSongInput } from './create-song.schema';
import { SongEditProposalStatus } from '../enums/song-edit-proposal-status.enum';
import { SongUserRefDto } from './song-user-ref.dto';

// `payload` is echoed back verbatim (the exact snapshot stored on
// SongEditProposal.payload - see that entity's own comment) so a review UI
// can render the full proposed Song without a second request. Never
// includes anything about the *current* PUBLISHED content for comparison -
// the caller already has that via GET /songs/:id.
export interface SongEditProposalResponseDto {
  id: string;
  songId: string;
  proposedBy: SongUserRefDto | null;
  status: SongEditProposalStatus;
  payload: CreateSongInput;
  rejectionReason: string | null;
  reviewedBy: SongUserRefDto | null;
  reviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
