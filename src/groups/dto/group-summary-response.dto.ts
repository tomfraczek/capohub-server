import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupVisibility } from '../enums/group-visibility.enum';

// Row shape for GET /groups ("my groups") - myRoles are every Role
// Assignment the caller holds for that Group itself (not a group-wide
// property, and not stored on Membership - see ADR-028). A Membership may
// hold several Roles for the same Group at once (e.g. MEMBER + INSTRUCTOR
// + ADMIN together), so this is always an array, never a single Role -
// empty only in the unexpected case where no Role Assignment exists for an
// active Membership.
export interface GroupSummaryResponseDto {
  id: string;
  name: string;
  logoUrl: string | null;
  visibility: GroupVisibility;
  status: GroupStatus;
  myRoles: GroupRole[];
}
