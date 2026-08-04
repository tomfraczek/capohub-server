import { RoleAssignmentResponseDto } from './role-assignment-response.dto';

// The OWNER RoleAssignment rows themselves, not a membership - this shape
// works uniformly for both a Group transfer (no membership involved at
// all) and a Section transfer. `previousOwner` comes back revoked
// (revokedAt/revokedBy populated); `newOwner` is the freshly granted row.
export interface TransferOwnershipResponseDto {
  previousOwner: RoleAssignmentResponseDto;
  newOwner: RoleAssignmentResponseDto;
}
