// The subset of a Clerk user's profile that this app keeps in sync locally.
// displayName is deliberately absent - it's a local, app-owned field.
export interface ClerkProfile {
  email: string;
  avatarUrl: string | null;
  // Clerk's own `hasImage` (see UserService.fetchClerkProfile): true when
  // avatarUrl is a real uploaded/OAuth-provided photo, false when Clerk is
  // instead returning its own generated initials placeholder - Clerk's
  // imageUrl is never null/empty either way, so avatarUrl alone can't tell
  // the two apart. null only ever occurs for a test double that predates
  // this field and doesn't stub hasImage - the real Clerk SDK's User type
  // has it as a non-optional boolean, always populated.
  clerkHasImage: boolean | null;
}
