import { CordSegmentResponseDto } from '../../graduation/dto/rank-response.dto';
import { SectionMemberUserImageDto } from './section-member-user-ref.dto';

// One row of GET /groups/:id/followers - a person tied to the Group either
// through an active membership in one of its *direct* Sections, or through
// GroupFollow, or both (the two flags are independent - same pair as
// GroupResponseDto.isMemberThroughSection/isFollowing).
//
// Basic identity (displayName/apelido) is always returned as stored - it has
// no privacy toggle. The rank follows the user's own showFormalGroup/
// showFormalRank toggles, with no viewer exception.
export interface GroupAudienceMemberDto {
  user: {
    id: string;
    // Full name, else apelido, else publicCode (no name set at all) - see
    // users/display-name.util.ts.
    displayName: string;
    apelido: string | null;
    image: SectionMemberUserImageDto;
  };
  // The same "effective" rank the public profile shows: the formal Rank
  // while the user still holds the matching FormalGroupAffiliation (and
  // shows both their formal group and rank), otherwise their independent
  // rank; null when hidden or unset.
  rank: {
    name: string;
    cordSegments: CordSegmentResponseDto[];
  } | null;
  // Holds the Group's active OWNER RoleAssignment. Independent of the two
  // flags below - the owner usually also has memberships (creating a
  // Section makes its creator a MEMBER), so the app should show the owner
  // label in place of "member through Section".
  isOwner: boolean;
  isMemberThroughSection: boolean;
  isFollowing: boolean;
  // Every active (ACTIVE/READ_ONLY) membership behind isMemberThroughSection,
  // one per direct Section, sorted by Section name - what the app needs to
  // act on them through the Section's own member endpoints (remove/ban/
  // roles). Empty for a follower-only row.
  memberships: {
    membershipId: string;
    sectionId: string;
    sectionName: string;
  }[];
}
