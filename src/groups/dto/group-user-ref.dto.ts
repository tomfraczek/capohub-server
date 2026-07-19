// Minimal, public-safe reference to a User, used inside
// GroupMembershipResponseDto. Mirrors SongUserRefDto
// (songs/dto/song-user-ref.dto.ts) - never include email, clerkUserId or
// globalRole here.
export interface GroupUserRefDto {
  id: string;
  displayName: string;
}
