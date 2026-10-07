import { CommunityListVisibility } from '../enums/community-list-visibility.enum';
import { GroupStatus } from '../enums/group-status.enum';

// Group is a physically distinct entity type (see the Group/Section
// physical-split ADR, stage 1) - `parentGroupId` reflects its actual
// position in the hierarchy (null for a root Group), never a way to guess
// *what kind* of row this is; every row returned through this DTO is
// already known to be a Group.
export interface GroupResponseDto {
  id: string;
  parentGroupId: string | null;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  websiteUrl: string | null;
  facebookUrl: string | null;
  instagramUrl: string | null;
  youtubeUrl: string | null;
  // Profile visibility for viewers with no Role/Membership - see
  // group.entity.ts.
  isPublic: boolean;
  // "Dołączanie publiczne" off - setting this Group as one's formal Group
  // sends a join request instead (see group.entity.ts).
  joinRequiresApproval: boolean;
  isHidden: boolean;
  memberInvitesAllowed: boolean;
  followersVisibility: CommunityListVisibility;
  publicCode: string | null;
  status: GroupStatus;
  // Direct child Groups only (one level down) - not recursive.
  childGroupsCount: number;
  // Direct Sections only (one level down) - not recursive.
  directSectionsCount: number;
  // Formal members - users whose active (endedOn = null)
  // FormalGroupAffiliation points at this Group (see
  // formal-group-affiliation.entity.ts).
  membersCount: number;
  // Whether the viewer holds an active SectionMembership in one of this
  // Group's *direct* Sections (see GroupsService.resolveViewerRelation) -
  // never a membership on the Group itself (Group has none - see
  // group.entity.ts). `false` for an unauthenticated/system read with no
  // viewer.
  isMemberThroughSection: boolean;
  // Whether the viewer holds a GroupFollow row for this Group (see
  // group-follow.entity.ts) - entirely independent of
  // isMemberThroughSection above; a viewer can be true/false on either
  // independently of the other, including both true at once (module: "NIE
  // musisz usuwać istniejącego GroupFollow" when the follower later joins a
  // Section).
  isFollowing: boolean;
  // Whether the viewer has a PENDING Group join request for this Group
  // (formal Group awaiting approval - see MembershipRequestsService).
  // Withdrawable via DELETE /groups/:id/join-requests/mine.
  hasPendingJoinRequest: boolean;
  createdAt: string;
  updatedAt: string;
}
