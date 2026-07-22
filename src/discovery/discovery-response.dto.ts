import { GroupStatus } from '../groups/enums/group-status.enum';

/** Mirrors GroupResponseDto but filtered to publicly safe fields. */
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
   * True when this Group is a Root Group (parentGroup === null), meaning it
   * represents an Organization in the domain model (see ADR-001).  Clients
   * can use this flag to render "Join organization" vs "Join group" UI and
   * to decide which targetType to supply to POST /groups/:id/join.
   */
  isOrganization: boolean;
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
 * - 'ORGANIZATION': a Root Group (parentGroup === null) — represents an
 *   organization.  Use targetType = ORGANIZATION when calling
 *   POST /groups/:id/join.
 * - 'GROUP': a Child Group — represents a team, section, city chapter, etc.
 *   Use targetType = GROUP when calling POST /groups/:id/join.
 * - 'USER': a user profile.
 */
export type DiscoveredResourceType = 'USER' | 'GROUP' | 'ORGANIZATION';

export interface DiscoveredResourceDto {
  resourceType: DiscoveredResourceType;
  // Exactly one of the two profile shapes is non-null
  group: PublicGroupProfileDto | null;
  user: PublicUserProfileDto | null;
  // Whether the requesting user is already a member (org-level for groups,
  // N/A for users)
  isMember: boolean;
  // Whether the requesting user has a PENDING invitation or join request
  hasPendingRequest: boolean;
}
