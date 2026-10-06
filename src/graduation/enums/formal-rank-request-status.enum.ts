// Lifecycle of a FormalRankRequest (see that entity):
//
//   PENDING → APPROVED (terminal - the rank became the user's current one)
//           → REJECTED (terminal - nothing changed; the user may send a new
//             request later, which is a new row)
//           → CANCELLED (terminal - superseded by a newer request, or the
//             user's formal Group changed/ended)
//
// Unlike FormalRankCorrectionRequest, a decided row is never reused - same
// "terminal rows are history" rule as MembershipRequest.
export enum FormalRankRequestStatus {
  PENDING = 'PENDING',
  APPROVED = 'APPROVED',
  REJECTED = 'REJECTED',
  CANCELLED = 'CANCELLED',
}
