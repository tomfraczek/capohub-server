import { OwnershipTransferBlocker } from '../owner-formal-group';
import { GroupUserRefDto } from './group-user-ref.dto';

// One row of GET /groups/:id/ownership-transfer-candidates - an ADMIN of
// the Group and whether ownership may be transferred to them. `blocker`
// is null exactly when `eligible` is true:
//  - OWNS_ANOTHER_GROUP: they already own a live Group (one per user),
//  - OTHER_FORMAL_GROUP: they are a formal member of another Group, and
//    the new owner must become this Group's formal member.
export interface OwnershipTransferCandidateDto {
  user: GroupUserRefDto;
  eligible: boolean;
  blocker: OwnershipTransferBlocker | null;
}
