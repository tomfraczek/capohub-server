import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';
import { MembershipRequestStatus } from '../enums/membership-request-status.enum';
import { GroupUserRefDto } from './group-user-ref.dto';

// Minimal community reference used inside dashboard cards (invitations,
// join requests) - never the full GroupResponseDto. `isRootGroup` lets the
// frontend label the card "Group" vs "Section" without re-deriving it
// from a `parentId` the caller may not even have loaded (see PAD-001
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
  parentId: string | null;
  // The Group this community belongs to - itself, when this row already
  // *is* the Group. Needed to group Sections under their Group in the UI
  // even when they are not immediate children of it (hierarchy depth is
  // unlimited - ADR-002).
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

// Contextual capability data. `canCreateGroup` is a real global boolean
// (creating a Group requires no permission - see GroupsService.create).
// Every other field is a list of community ids, NOT a global boolean -
// which action is available always depends on which specific community
// (Group or Section) the user holds the underlying permission for, so the
// frontend always receives the exact set of ids rather than a
// lie-by-omission boolean (see PAD-001 §17.4 "Permission Transparency").
// The frontend must never compute any of these from
// `myRoles`/`myCommunities` - always read them from here.
export interface CommunityHomeCapabilitiesDto {
  canCreateGroup: boolean;
  canCreateSectionInCommunityIds: string[];
  canReviewJoinRequestsInCommunityIds: string[];
  // Read access to a community's member list (GET .../members) - works in
  // any Group status.
  canViewMembersInCommunityIds: string[];
  // Add/remove a member (MEMBERSHIP_ADD/MEMBERSHIP_REMOVE tier) - requires
  // the Group to be ACTIVE.
  canManageMembersInCommunityIds: string[];
  // Send a new Invitation for this community - requires ACTIVE, and, for a
  // caller whose only roles are MEMBER/ASSISTANT/INSTRUCTOR,
  // Group.memberInvitesAllowed === true (ADMIN/OWNER bypass that setting -
  // see docs "Role → Permission reference" footnote).
  canInviteMembersInCommunityIds: string[];
  // Cancel/resend an existing Invitation on another member's behalf
  // (MEMBERSHIP_INVITE tier) - requires ACTIVE.
  canManageInvitationsInCommunityIds: string[];
  // Grant/revoke a Role Assignment (MEMBERSHIP_ROLE_CHANGE) - requires
  // ACTIVE.
  canManageRolesInCommunityIds: string[];
  // Transfer ownership (GROUP_OWNERSHIP_TRANSFER, OWNER-only) - requires
  // ACTIVE.
  canTransferOwnershipInCommunityIds: string[];
  // Archive (GROUP_ARCHIVE, OWNER-only) - valid from ACTIVE or READ_ONLY.
  canArchiveCommunityIds: string[];
  // Unarchive/"Restore" (GROUP_UNARCHIVE, OWNER-only) - valid only from
  // ARCHIVED. Unlike every other list here, communities that qualify are
  // NOT necessarily present in `myCommunities` (ARCHIVED communities are
  // excluded from it - see myCommunities below) - resolve the community's
  // own name/logo via GET /groups/:id if you need to display it.
  canRestoreCommunityIds: string[];
  // Permanently delete (GROUP_DELETE, OWNER-only, see ADR-029) - valid from
  // ACTIVE, READ_ONLY, or ARCHIVED. Same "may not be in myCommunities" note
  // as canRestoreCommunityIds applies to any ARCHIVED community here.
  canDeleteCommunityIds: string[];
  // Read this community's Audit Log (AUDIT_LOG_VIEW) - works in any Group
  // status, including DELETED (historical data remains visible - ADR-007).
  canViewAuditLogInCommunityIds: string[];
  // Manage the caller's own Community Notification settings - available to
  // every community with an ACTIVE Membership, independent of Role (see
  // CommunityNotificationSettingsService) - deliberately not a
  // Role/Permission-gated capability like every other one here.
  canManageNotificationsInCommunityIds: string[];
  // Ban/unban a member (MEMBERSHIP_BAN/MEMBERSHIP_UNBAN tier) - requires
  // ACTIVE.
  canBanMembersInCommunityIds: string[];
  // Suspend/unsuspend a member (MEMBERSHIP_SUSPEND/MEMBERSHIP_UNSUSPEND
  // tier) - requires ACTIVE.
  canSuspendMembersInCommunityIds: string[];
  // True iff canCreateSectionInCommunityIds is non-empty - i.e. the user
  // holds GROUP_EDIT (Admin/Owner) in at least one community, Group or
  // Section. A convenience aggregate, not an independent business rule.
  canManageAnyCommunity: boolean;
}

export interface CommunityHomeResponseDto {
  myCommunities: CommunityHomeCommunityDto[];
  pendingInvitations: CommunityHomeBoundedSectionDto<CommunityHomeInvitationDto>;
  pendingJoinRequests: CommunityHomeBoundedSectionDto<CommunityHomeJoinRequestDto>;
  summary: CommunityHomeSummaryDto;
  capabilities: CommunityHomeCapabilitiesDto;
}
