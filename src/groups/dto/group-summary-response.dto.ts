import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupVisibility } from '../enums/group-visibility.enum';

// Row shape for GET /groups ("my groups") - myRole is the caller's own
// active GroupMembership.role in that group, not a group-wide property.
export interface GroupSummaryResponseDto {
  id: string;
  name: string;
  logoUrl: string | null;
  visibility: GroupVisibility;
  status: GroupStatus;
  myRole: GroupRole;
}
