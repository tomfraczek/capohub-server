// The subset of a Clerk user's profile that this app keeps in sync locally.
// displayName is deliberately absent - it's a local, app-owned field.
export interface ClerkProfile {
  email: string;
  avatarUrl: string | null;
}
