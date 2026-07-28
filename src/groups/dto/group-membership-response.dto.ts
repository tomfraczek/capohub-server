import { GroupMembershipStatus } from '../enums/group-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { MembershipEndReason } from '../enums/membership-end-reason.enum';
import { GroupUserRefDto } from './group-user-ref.dto';
import { MembershipCohortRefDto } from './membership-cohort-ref.dto';

export interface GroupMembershipResponseDto {
  id: string;
  rootGroupId: string;
  user: GroupUserRefDto;
  // Membership never stores a Role (see ADR-028) - this reflects every
  // Role Assignment currently held for the Root Group itself, resolved via
  // a separate lookup. A Membership may hold several Roles for the same
  // Group at once (e.g. MEMBER + INSTRUCTOR + ADMIN together), so this is
  // always an array, never a single Role. Empty is a normal, expected
  // state: Membership represents only "belongs to the organization" and
  // never implies any Role in the Root Group by itself (see ADR-028/
  // ADR-004) - a member who has not yet been assigned any Role there has
  // an empty array here.
  rootRoles: GroupRole[];
  status: GroupMembershipStatus;
  joinedAt: string;
  leftAt: string | null;
  endReason: MembershipEndReason | null;
  cohorts: MembershipCohortRefDto[];
}
