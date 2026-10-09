import { CordSegmentResponseDto } from '../../graduation/dto/rank-response.dto';
import { RankTrack } from '../../graduation/enums/rank-track.enum';
import { GroupRole } from '../../groups/enums/group-role.enum';
import { AvatarType } from '../enums/avatar-type.enum';

// The subset of GroupRole meaningful as *capoeira* identity, never
// authorization/administrative facts about the app itself. OWNER/ADMIN
// grant real permissions (GROUP_EDIT, MEMBERSHIP_REMOVE, ...) - who
// manages a Section is an app-authorization detail, not something a
// visitor's profile should ever reveal, so those two are never present
// here regardless of what the target's real RoleAssignments say. MEMBER
// carries no information on its own (already implied by appearing in the
// list at all) and is filtered out too - only a *notable* capoeira role is
// worth surfacing.
export type PublicSectionRoleDto = GroupRole.INSTRUCTOR | GroupRole.ASSISTANT;

// `roles`/`logoUrl` were deliberately absent here until now (see the git
// history of this file) - the original design treated `sections` as
// "membership only", never role/status data, to avoid leaking who holds
// admin power over a Section through a field that reads as ordinary
// membership. That decision is intentionally reversed for capoeira-
// representative roles only (Instrutor/Assistente - see
// PublicSectionRoleDto above): the original concern (leaking who holds
// administrative power) still fully applies to OWNER/ADMIN, which this
// field never carries. Still entirely behind the same single
// `showSections` gate as the rest of this field, never a separate flag.
export interface PublicSectionRefDto {
  id: string;
  name: string;
  logoUrl: string | null;
  roles: PublicSectionRoleDto[];
}

export interface PublicFormalGroupRefDto {
  id: string;
  name: string;
}

export interface PublicFormalRankRefDto {
  name: string;
  cordSegments: CordSegmentResponseDto[];
  sourceGroup: { id: string; name: string } | null;
  startedOn: string | null;
}

// A user's independent ("custom") cordão - see CustomUserRank. Narrower
// than CustomUserRankResponseDto by design, same "only what's needed"
// scope as PublicFormalRankRefDto above: no id, no description,
// createdAt/updatedAt.
export interface PublicIndependentRankRefDto {
  name: string;
  track: RankTrack;
  cordSegments: CordSegmentResponseDto[];
}

// GET /users/:userId/profile - filtered per-viewer according to the
// target's privacy toggles (see UserProfileService). Basic identity -
// firstName/lastName/apelido and the displayName built from them - has no
// toggle and is always returned as stored (`null` only when not set).
// Every other field is `null` exactly when it is not visible to the
// requesting viewer - the client never receives a value it isn't allowed
// to see.
//
// No `groups` field - a Group has no membership, so the only thing such a
// list could show is which Groups this user administers (OWNER/ADMIN
// RoleAssignment), and surfacing that here would leak an administrative
// fact through a field that reads as ordinary membership.
export interface PublicUserProfileResponseDto {
  userId: string;
  // Full name, else apelido, else publicCode - see display-name.util.ts's
  // resolveFullName. Deliberately NOT the target's DisplayNameMode: the
  // full profile screen keeps its own layout of every identity field.
  displayName: string;
  // Unconditionally public, never privacy-gated - same precedent as
  // EventOrganizerUserImageDto (an Event's organizer avatar, shown to any
  // attendee with no toggle): "displayName and the avatar fields are
  // already public-safe elsewhere in this codebase". A PRESET avatar has
  // no URL at all (the app resolves presetAvatarId to an asset locally),
  // mirroring User.avatarType/avatarUrl/presetAvatarId directly rather
  // than collapsing to a single `imageUrl`.
  avatarType: AvatarType;
  avatarUrl: string | null;
  presetAvatarId: string | null;
  firstName: string | null;
  lastName: string | null;
  apelido: string | null;
  capoeiraStartedAt: string | null;
  sections: PublicSectionRefDto[] | null;
  formalGroup: PublicFormalGroupRefDto | null;
  // Gated by User.showFormalRank (see UserProfileService.getPublicProfile) -
  // `null` when hidden, when the target simply has no active
  // FormalRankAssignment (FormalRankService.getCurrentOrNull), or when the
  // target's current FormalRankAssignment is a stale carry-over from a
  // formal Group they have since left (endFormalGroup only ends the
  // FormalGroupAffiliation row, not the FormalRankAssignment itself - see
  // UserProfileService.getPublicProfile's own comment on this gate, local
  // to this endpoint only).
  formalRank: PublicFormalRankRefDto | null;
  // The target's independent/"custom" cordão (CustomUserRank), reusing the
  // exact same `showFormalRank` toggle as `formalRank` above rather than a
  // dedicated flag - see UserProfileService.getPublicProfile for why. Null
  // when hidden or when the target has not set one
  // (CustomUserRankService.getCurrentOrNull).
  independentRank: PublicIndependentRankRefDto | null;
}
