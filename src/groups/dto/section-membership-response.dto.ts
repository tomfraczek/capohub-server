import { SectionMembershipStatus } from '../enums/section-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import { GroupUserRefDto } from './group-user-ref.dto';
import { MembershipCohortRefDto } from './membership-cohort-ref.dto';

export interface SectionMembershipResponseDto {
  id: string;
  sectionId: string;
  user: GroupUserRefDto;
  // Every active Role Assignment currently held for this Section, resolved
  // via a separate lookup (RoleAssignment has no relation to this entity -
  // see role-assignment.entity.ts). Always includes MEMBER for an
  // ACTIVE/READ_ONLY membership - a Section membership always carries its
  // base Role, unlike the old Root-Group Membership, which could be
  // roleless.
  roles: GroupRole[];
  status: SectionMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  endReason: MembershipEndReason | null;
  endedBy: GroupUserRefDto | null;
  cohorts: MembershipCohortRefDto[];
}
