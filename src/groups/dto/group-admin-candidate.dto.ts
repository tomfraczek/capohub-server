import { GroupRole } from '../enums/group-role.enum';
import { SectionMemberUserImageDto } from './section-member-user-ref.dto';

// One row of GET /groups/:groupId/role-assignments/admin-candidates - a
// formal member of the Group (active FormalGroupAffiliation with it). Same presentation fields as
// UserSearchResultDto (users/dto/user-search-result.dto.ts), so the app
// renders both with one row shape. Never carries email, clerkUserId or
// globalRole.
export interface GroupAdminCandidateDto {
  id: string;
  // Full name, else apelido, else publicCode (no name set at all) - see
  // users/display-name.util.ts. Never `User.displayName`.
  displayName: string;
  apelido: string | null;
  image: SectionMemberUserImageDto;
  numericCode: string;
  // The Group role this member already holds - non-null means they cannot
  // be picked again (the app shows them as "already added"). null = may be
  // granted ADMIN.
  currentRole: GroupRole.OWNER | GroupRole.ADMIN | null;
}
