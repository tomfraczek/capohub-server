import { GroupRole } from '../enums/group-role.enum';
import { SectionMemberUserImageDto } from './section-member-user-ref.dto';

// grantedBy/revokedBy - a bare label is all an audit-style reference needs.
export interface RoleAssignmentUserRefDto {
  id: string;
  // Full name, else apelido, else publicCode (no name set at all) - see
  // users/display-name.util.ts. Never `User.displayName` (the separate,
  // email-seeded account label).
  displayName: string;
}

// The role holder itself - what the Roles screen renders as a user row
// (avatar, full name, apelido). Basic identity has no privacy toggle, so
// these are always returned as stored. Still never carries email,
// clerkUserId or globalRole.
export interface RoleAssignmentUserDto extends RoleAssignmentUserRefDto {
  firstName: string | null;
  lastName: string | null;
  apelido: string | null;
  image: SectionMemberUserImageDto;
}

export interface RoleAssignmentResponseDto {
  id: string;
  groupId: string;
  user: RoleAssignmentUserDto;
  role: GroupRole;
  grantedAt: string;
  grantedBy: RoleAssignmentUserRefDto | null;
  revokedAt: string | null;
  revokedBy: RoleAssignmentUserRefDto | null;
}
