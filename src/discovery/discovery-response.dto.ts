import { GroupStatus } from '../groups/enums/group-status.enum';

/** Mirrors GroupResponseDto/SectionResponseDto but filtered to publicly safe fields. */
export interface PublicGroupProfileDto {
  id: string;
  name: string;
  description: string | null;
  logoUrl: string | null;
  coverImageUrl: string | null;
  websiteUrl: string | null;
  status: GroupStatus;
  isPublic: boolean;
  isHidden: boolean;
  publicCode: string | null;
  /**
   * True when this Group is a root Group (parentGroup === null), i.e. it is
   * presented as "Group" rather than "Section" (see the Group/Section
   * rename ADR). Clients can use this flag to render "Join group" vs "Join
   * section" UI and to decide which targetType to supply to
   * POST /groups/:id/join or POST /sections/:id/join.
   */
  isRootGroup: boolean;
}

/** Public user profile - only fields safe to expose to any authenticated user. */
export interface PublicUserProfileDto {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  publicCode: string | null;
}

/**
 * The type of the discovered resource.
 *
 * - 'GROUP': a root Group (parentGroup === null). Use targetType = GROUP
 *   when calling POST /groups/:id/join.
 * - 'SECTION': a non-root Group, at any depth — represents a team, city
 *   chapter, etc. Use targetType = SECTION when calling
 *   POST /sections/:id/join.
 * - 'USER': a user profile.
 */
export type DiscoveredResourceType = 'USER' | 'GROUP' | 'SECTION';

export interface DiscoveredResourceDto {
  resourceType: DiscoveredResourceType;
  // Exactly one of the two profile shapes is non-null
  group: PublicGroupProfileDto | null;
  user: PublicUserProfileDto | null;
  // Whether the requesting user is already a member (root-Group-level for
  // groups/sections, N/A for users)
  isMember: boolean;
  // Whether the requesting user has a PENDING invitation or join request
  hasPendingRequest: boolean;
}
