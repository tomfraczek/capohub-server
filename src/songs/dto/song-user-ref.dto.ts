// Minimal, public-safe reference to a User, used anywhere a Song or
// SongMedia exposes who created it. Never include email, clerkUserId or
// globalRole here - see song.mapper.ts.
export interface SongUserRefDto {
  id: string;
  displayName: string;
}
