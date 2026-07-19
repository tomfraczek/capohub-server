import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupUserRefDto } from './group-user-ref.dto';

export interface GroupMembershipResponseDto {
  id: string;
  user: GroupUserRefDto;
  role: GroupRole;
  status: GroupMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
}
