import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import { GroupUserRefDto } from './group-user-ref.dto';
import { MembershipSectionRefDto } from './membership-section-ref.dto';

export interface GroupMembershipResponseDto {
  id: string;
  rootGroupId: string;
  user: GroupUserRefDto;
  role: GroupRole;
  status: GroupMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  endReason: MembershipEndReason | null;
  sections: MembershipSectionRefDto[];
}
