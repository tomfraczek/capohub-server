import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';
import { MembershipRequestStatus } from '../enums/membership-request-status.enum';
import { GroupUserRefDto } from './group-user-ref.dto';

// Minimal community reference used inside dashboard cards (invitations,
// join requests) - never the full GroupResponseDto. `isRootGroup` lets the
// frontend label the card "Organization" vs "Group" without re-deriving it
// from a `parentGroupId` the caller may not even have loaded (see PAD-001
// §3.3 Shared Screens).
export interface CommunityHomeCommunityRefDto {
  id: string;
  name: string;
  logoUrl: string | null;
  isRootGroup: boolean;
}

// Row shape for the "My Communities" section. Deliberately excludes
// `memberCount` (not implemented - see PAD-001 §19.1) and never collapses
// `myRoles` into a single `role` (a Membership may hold several Roles for
// the same Group at once - ADR-028).
export interface CommunityHomeCommunityDto {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  parentGroupId: string | null;
  // The Root Group (Organization) this community belongs to - itself, when
  // this row already *is* the Root Group. Needed to group Child Groups
  // under their Organization in the UI even when they are not immediate
  // children of it (hierarchy depth is unlimited - ADR-002).
  rootGroupId: string;
  isRootGroup: boolean;
  myRoles: GroupRole[];
  isPublic: boolean;
  isHidden: boolean;
  status: GroupStatus;
}

export interface CommunityHomeInvitationDto {
  id: string;
  community: CommunityHomeCommunityRefDto;
  inviter: GroupUserRefDto;
  targetType: MembershipRequestTarget;
  status: MembershipRequestStatus;
  createdAt: string;
}

export interface CommunityHomeJoinRequestDto {
  id: string;
  community: CommunityHomeCommunityRefDto;
  requestedBy: GroupUserRefDto;
  targetType: MembershipRequestTarget;
  status: MembershipRequestStatus;
  createdAt: string;
}

// Generic shape for a capped dashboard section - see docs/api-conventions.md
// ("Dashboard section shape"). `total` and `hasMore` always describe the
// full matching set, not just `items`, so summary counts stay consistent
// with what was actually returned.
export interface CommunityHomeBoundedSectionDto<T> {
  items: T[];
  total: number;
  hasMore: boolean;
}

export interface CommunityHomeSummaryDto {
  communitiesCount: number;
  pendingInvitationsCount: number;
  pendingJoinRequestsCount: number;
  actionableItemsCount: number;
}

// Contextual capability data. `canCreateOrganization` is a real global
// boolean (creating a Root Group requires no permission - see
// GroupsService.create). The other two are NOT global booleans - which
// action is available always depends on which community the user has
// GROUP_EDIT / GROUP_JOIN_REQUEST_REVIEW for, so the frontend receives the
// exact set of community ids rather than a lie-by-omission boolean (see
// PAD-001 §17.4 "Permission Transparency").
export interface CommunityHomeCapabilitiesDto {
  canCreateOrganization: boolean;
  canCreateGroupInCommunityIds: string[];
  canReviewJoinRequestsInCommunityIds: string[];
  // True iff canCreateGroupInCommunityIds is non-empty - i.e. the user
  // holds GROUP_EDIT (Admin/Owner) in at least one community, root or
  // child. A convenience aggregate, not an independent business rule.
  canManageAnyCommunity: boolean;
}

export interface CommunityHomeResponseDto {
  myCommunities: CommunityHomeCommunityDto[];
  pendingInvitations: CommunityHomeBoundedSectionDto<CommunityHomeInvitationDto>;
  pendingJoinRequests: CommunityHomeBoundedSectionDto<CommunityHomeJoinRequestDto>;
  summary: CommunityHomeSummaryDto;
  capabilities: CommunityHomeCapabilitiesDto;
}
