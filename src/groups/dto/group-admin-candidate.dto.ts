import { SectionMemberUserImageDto } from './section-member-user-ref.dto';

// One row of GET /groups/:groupId/role-assignments/admin-candidates - a
// formal member of the Group (active FormalGroupAffiliation with it) who
// does not hold OWNER/ADMIN there yet. Same presentation fields as
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
}
