// Lifecycle of a FormalRankCorrectionRequest (see that entity). Four
// states only - no EXPIRED (no expiry mechanism exists) and no CANCELLED
// (no cancel operation exists - see the module spec: "Nie dodawaj
// osobnego CANCELLED, jeśli nie ma jawnej operacji anulowania").
//
//   CORRECTION_REQUIRED → PENDING_APPROVAL → APPROVED
//                              ↑    ↓
//                              └─ REJECTED (resubmitting goes straight
//                                 back to PENDING_APPROVAL - see
//                                 FormalRankCorrectionService.submit)
//
// REJECTED is not terminal: the same row is reused across reject/
// resubmit cycles (see the module spec, rule 7) - only APPROVED is a true
// end state. "Active" (blocks a second request for the same
// FormalRankAssignment - see FORMAL_RANK_CORRECTION_REQUESTS_ACTIVE_UNIQUE_INDEX)
// means CORRECTION_REQUIRED, PENDING_APPROVAL, or REJECTED.
export enum FormalRankCorrectionStatus {
  CORRECTION_REQUIRED = 'CORRECTION_REQUIRED',
  PENDING_APPROVAL = 'PENDING_APPROVAL',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
}

export const ACTIVE_FORMAL_RANK_CORRECTION_STATUSES: readonly FormalRankCorrectionStatus[] =
  [
    FormalRankCorrectionStatus.CORRECTION_REQUIRED,
    FormalRankCorrectionStatus.PENDING_APPROVAL,
    FormalRankCorrectionStatus.REJECTED,
  ];
