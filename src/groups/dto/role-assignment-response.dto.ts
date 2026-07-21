import { GroupRole } from '../enums/group-role.enum';

export interface RoleAssignmentResponseDto {
  id: string;
  groupId: string;
  membershipId: string;
  user: {
    id: string;
    displayName: string;
  };
  role: GroupRole;
  grantedAt: string;
}
