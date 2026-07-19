import { GroupMembershipResponseDto } from './group-membership-response.dto';

export interface TransferOwnershipResponseDto {
  previousOwner: GroupMembershipResponseDto;
  newOwner: GroupMembershipResponseDto;
}
