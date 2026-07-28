// Minimal Community reference embedded in Event responses - mirrors
// CommunityHomeCommunityRefDto (see groups/dto/community-home-response.dto.ts).
// `isRootGroup` lets the frontend label it "Organization" vs "Group"
// without re-deriving it from a `parentGroupId` it may not have loaded.
export interface EventCommunityRefDto {
  id: string;
  name: string;
  logoUrl: string | null;
  isRootGroup: boolean;
}
