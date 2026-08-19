// Lifecycle state of a SongEditProposal (see song-edit-proposal.entity.ts).
// Deliberately separate from SongStatus - a proposal's own status never
// changes the Song's status; approving one only ever moves data (the
// snapshot) onto the Song, never its status (see
// SongEditProposalsService.approve).
export enum SongEditProposalStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}
