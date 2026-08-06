// The four notification types the correction workflow raises (see the
// module spec, section 9) - each a plain persisted record, never a push/
// email (no such delivery infrastructure exists in this codebase - see
// FormalRankCorrectionNotification's own comment).
export enum FormalRankCorrectionNotificationType {
  // Recipient: the target user - their formal rank was flagged for
  // correction by their Section's OWNER/ADMIN.
  FORMAL_RANK_CORRECTION_REQUESTED = 'FORMAL_RANK_CORRECTION_REQUESTED',
  // Recipients: the reporter (reportedBy) and the Section's OWNER,
  // deduplicated (they may be the same person) - the target submitted a
  // proposed correction and it now needs review.
  FORMAL_RANK_CORRECTION_SUBMITTED = 'FORMAL_RANK_CORRECTION_SUBMITTED',
  // Recipient: the target user - their submitted correction was approved.
  FORMAL_RANK_CORRECTION_APPROVED = 'FORMAL_RANK_CORRECTION_APPROVED',
  // Recipient: the target user - their submitted correction was rejected.
  FORMAL_RANK_CORRECTION_REJECTED = 'FORMAL_RANK_CORRECTION_REJECTED',
}
