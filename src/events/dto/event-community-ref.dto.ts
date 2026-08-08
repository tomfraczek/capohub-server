// Minimal Community reference embedded in Event responses - mirrors
// CommunityHomeCommunityRefDto (see groups/dto/community-home-response.dto.ts).
// `isRootGroup` lets the frontend label it "Group" vs "Group"
// without re-deriving it from a `parentGroupId` it may not have loaded.
// `communityType` is the plain Group-vs-Section discriminant (unlike
// `isRootGroup`, which only distinguishes a root Group from everything
// else) - added for CalendarService, which needs to tell a Group-owned
// Event from a Section-owned one without re-querying the entity (see
// calendar/mappers/calendar-item.mapper.ts).
export interface EventCommunityRefDto {
  id: string;
  name: string;
  logoUrl: string | null;
  isRootGroup: boolean;
  communityType: 'GROUP' | 'SECTION';
}
