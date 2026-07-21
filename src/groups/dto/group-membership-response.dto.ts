import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import { GroupUserRefDto } from './group-user-ref.dto';
import { MembershipSectionRefDto } from './membership-section-ref.dto';

export interface GroupMembershipResponseDto {
  id: string;
  rootGroupId: string;
  user: GroupUserRefDto;
  // Membership never stores a Role (see ADR-028) - this reflects every
  // Role Assignment currently held for the Root Group itself, resolved via
  // a separate lookup. A Membership may hold several Roles for the same
  // Group at once (e.g. MEMBER + INSTRUCTOR + ADMIN together), so this is
  // always an array, never a single Role - empty only if no Role
  // Assignment exists, which should not normally happen for an ACTIVE
  // Membership (see RoleAssignmentsService.ensureMemberRole).
  rootRoles: GroupRole[];
  status: GroupMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  endReason: MembershipEndReason | null;
  sections: MembershipSectionRefDto[];
}
