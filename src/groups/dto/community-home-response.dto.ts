import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { MembershipRequestTarget } from '../enums/membership-request-target.enum';
import { MembershipRequestStatus } from '../enums/membership-request-status.enum';
import {
  CommunityDiscoveryContextDto,
  CommunityGroupCardDto,
  CommunityLocationSummaryDto,
  CommunityOverviewBoundedSectionDto,
  CommunitySectionCardDto,
  NearbyGroupCardDto,
  NearbySectionCardDto,
} from './community-overview-response.dto';
import { GroupUserRefDto } from './group-user-ref.dto';

// Minimal community reference used inside dashboard cards (invitations,
// join requests) - never the full GroupResponseDto/SectionResponseDto.
// `isGroup` lets the frontend label the card "Group" vs "Section" without
// re-deriving it from a `parentId` the caller may not even have loaded.
// Computed directly from the entity's own type (`instanceof Group`), never
// from `parentGroup === null` - a non-root child Group is still a Group,
// not a Section (the old `isRootGroup` name conflated the two).
export interface CommunityHomeCommunityRefDto {
  id: string;
  name: string;
  logoUrl: string | null;
  isGroup: boolean;
}

// Row shape for the "My Communities" section. Deliberately excludes
// `memberCount` (not implemented) and never collapses `myRoles` into a
// single `role` (a user may hold several Roles for the same target at
// once).
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
  // unlimited).
  rootGroupId: string;
  isGroup: boolean;
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

// Generic shape for a capped dashboard section. `total` and `hasMore`
// always describe the full matching set, not just `items`, so summary
// counts stay consistent with what was actually returned.
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

// Contextual capability data. `canCreateGroup` and `canCreateStandaloneSection`
// are real global booleans (creating a Group, or creating a Section with no
// parent, both require no permission at all - see GroupsService.create and
// SectionsService.createStandalone / ADR-032). Every other capability is a
// *pair* of community-id lists - `...GroupIds`
// and `...SectionIds` - never one mixed list: Group and Section have
// genuinely different, non-inheriting authorization (Group has no
// membership at all), and this codebase's established convention for "a
// Group-or-Section reference" is always two explicit, disjoint fields,
// never a single field carrying a type tag (see RoleAssignment/
// Announcement/Event's own dual-FK pattern). Capabilities that are
// structurally Section-only (membership-lifecycle: ban/suspend/invite/
// join-request-review/manage-members) still declare both fields for
// uniformity, but `...GroupIds` for those is always empty - itself
// meaningful ("this can never apply to a Group"), not a gap.
//
// The frontend must never compute any of these from
// `myRoles`/`myCommunities` - always read them from here.
export interface CommunityHomeCapabilitiesDto {
  canCreateGroup: boolean;
  // Any authenticated user may create a standalone Section (no parent
  // Group) - see ADR-032. Deliberately not a community-id list like
  // canCreateSectionIn{Group,Section}Ids below: those gate creating a
  // Section *under* a specific, already-existing community the caller
  // administers; this one has no such community to key off of, mirroring
  // canCreateGroup's own shape.
  canCreateStandaloneSection: boolean;
  canCreateSectionInGroupIds: string[];
  canCreateSectionInSectionIds: string[];
  canCreateEventInGroupIds: string[];
  canCreateEventInSectionIds: string[];
  // Section-only (Group has no membership/join-request flow at all).
  canReviewJoinRequestsInSectionIds: string[];
  canViewMembersInSectionIds: string[];
  canManageMembersInSectionIds: string[];
  canInviteMembersInSectionIds: string[];
  canManageInvitationsInSectionIds: string[];
  canBanMembersInSectionIds: string[];
  canSuspendMembersInSectionIds: string[];
  // Grant/revoke a Role Assignment - both Group and Section support this.
  canManageRolesInGroupIds: string[];
  canManageRolesInSectionIds: string[];
  canTransferOwnershipInGroupIds: string[];
  canTransferOwnershipInSectionIds: string[];
  canArchiveGroupIds: string[];
  canArchiveSectionIds: string[];
  // Communities that qualify are NOT necessarily present in
  // `myCommunities` (ARCHIVED communities are excluded from it) - resolve
  // the community's own name/logo via GET /groups/:id or
  // GET /sections/:id if you need to display it.
  canRestoreGroupIds: string[];
  canRestoreSectionIds: string[];
  canDeleteGroupIds: string[];
  canDeleteSectionIds: string[];
  canViewAuditLogInGroupIds: string[];
  canViewAuditLogInSectionIds: string[];
  // Manage the caller's own Community Notification settings - Section-only
  // (Group has no membership, so no "own" notification row - see
  // CommunityNotificationSettingsService), available to every Section with
  // an ACTIVE membership, independent of Role.
  canManageNotificationsInSectionIds: string[];
  canManageAnnouncementsInGroupIds: string[];
  canManageAnnouncementsInSectionIds: string[];
  canViewAnnouncementArchiveInGroupIds: string[];
  canViewAnnouncementArchiveInSectionIds: string[];
  canViewRecipientGroupsInGroupIds: string[];
  canViewRecipientGroupsInSectionIds: string[];
  canManageRecipientGroupsInGroupIds: string[];
  canManageRecipientGroupsInSectionIds: string[];
  // Training/TrainingSeries are Section-only (a Training never belongs to a
  // Group) - no ...InGroupIds counterpart, mirroring the membership-lifecycle
  // fields above. Create-Training, create-Series, and manage-Series
  // (edit/cancel) all gate on the identical TRAINING_MANAGE permission at
  // the endpoint level (see TrainingsController/TrainingSeriesController) -
  // three distinct fields for frontend clarity, one underlying check.
  canCreateTrainingInSectionIds: string[];
  canCreateTrainingSeriesInSectionIds: string[];
  canManageTrainingSeriesInSectionIds: string[];
  // TRAINING_STATS_VIEW - deliberately withheld from INSTRUCTOR, see the
  // permission enum's own comment.
  canViewTrainingStatsInSectionIds: string[];
  // GRADUATION_SYSTEM_MANAGE - Group-only (a Section never defines its own
  // graduation catalog, see GraduationSystemController's @RequireGroupKind
  // (ROOT)), ACTIVE-only like every write endpoint there. No
  // ...InSectionIds counterpart, same as the Training lists' reverse.
  canManageGraduationSystemInGroupIds: string[];
  // GROUP_FOLLOWERS_VIEW - GET /groups/:id/followers (Section members +
  // followers). Group-only, any status (mirrors the endpoint's
  // @AllowGroupStatuses).
  canViewFollowersInGroupIds: string[];
  // GROUP_FOLLOWERS_MANAGE - remove a follower / block following.
  // Group-only, ACTIVE Groups only (the write endpoints' default).
  canManageFollowersInGroupIds: string[];
  // True iff canCreateSectionIn{Group,Section}Ids is non-empty - i.e. the
  // user holds GROUP_EDIT (Admin/Owner) in at least one community. A
  // convenience aggregate, not an independent business rule.
  canManageAnyCommunity: boolean;
}

export interface CommunityHomeResponseDto {
  myCommunities: CommunityHomeCommunityDto[];
  pendingInvitations: CommunityHomeBoundedSectionDto<CommunityHomeInvitationDto>;
  pendingJoinRequests: CommunityHomeBoundedSectionDto<CommunityHomeJoinRequestDto>;
  summary: CommunityHomeSummaryDto;
  capabilities: CommunityHomeCapabilitiesDto;

  // ─── Section/Group membership overview + nearby discovery (see
  // CommunityOverviewService) - a distinct concern from myCommunities above,
  // which is purely Role-Assignment-based ("what do I administer"). These
  // five answer "what am I part of, and what's around me" instead: mySections/
  // myGroups are membership/follow-based (never a Role requirement), and
  // nearbySections/nearbyGroups are derived from the caller's own discovery
  // location (see users/entities/user-discovery-location.entity.ts). Every
  // list here is capped for a carousel - see community-overview.constants.ts
  // - the full, paginated equivalents are GET
  // /community/{sections,groups}/{mine,nearby}. ────────────────────────────

  location: CommunityLocationSummaryDto;
  mySections: CommunityOverviewBoundedSectionDto<CommunitySectionCardDto>;
  myGroups: CommunityOverviewBoundedSectionDto<CommunityGroupCardDto>;
  // Always empty (never an error) when `location.configured` is false - see
  // CommunityOverviewService.getNearbySections/getNearbyGroups.
  nearbySections: CommunityOverviewBoundedSectionDto<NearbySectionCardDto>;
  nearbyGroups: CommunityOverviewBoundedSectionDto<NearbyGroupCardDto>;

  // ─── Discovery fallback ("Community Home nie może być pusty") - only ever
  // populated when nearbySections AND nearbyGroups both came back empty
  // while a discovery location IS configured (see
  // CommunityDiscoveryContextDto's own comment for the three fallbackType
  // states). Excludes everything already in mySections/myGroups, same as
  // nearbySections/nearbyGroups - see CommunityOverviewService. ───────────

  discoverySections: CommunityOverviewBoundedSectionDto<NearbySectionCardDto>;
  discoveryGroups: CommunityOverviewBoundedSectionDto<NearbyGroupCardDto>;
  discoveryContext: CommunityDiscoveryContextDto;
}
