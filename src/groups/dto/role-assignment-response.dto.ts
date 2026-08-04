import { GroupRole } from '../enums/group-role.enum';

export interface RoleAssignmentUserRefDto {
  id: string;
  displayName: string;
}

export interface RoleAssignmentResponseDto {
  id: string;
  groupId: string;
  user: RoleAssignmentUserRefDto;
  role: GroupRole;
  grantedAt: string;
  grantedBy: RoleAssignmentUserRefDto | null;
  revokedAt: string | null;
  revokedBy: RoleAssignmentUserRefDto | null;
}
