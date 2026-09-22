// Which external OAuth provider a Clerk account is linked through, if any
// (a password/email-only Clerk account has none). Only 'google' is ever
// resolved to a provider-specific signal today (see
// UserService.syncGoogleHasCustomPhoto) - 'other' is a deliberate, safe
// catch-all for every other provider Clerk supports (Facebook, Apple,
// GitHub, ...), so adding a second provider-specific signal later is a new
// branch on this type, not a rewrite of how it's resolved.
export type ExternalAccountProvider = 'google' | 'other';

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
  //
  // IMPORTANT: this signal turned out to be insufficient on its own for
  // Google accounts - Google returns `hasImage: true` (via Clerk) even for
  // its own auto-generated "colored circle with an initial" default
  // avatar, not just for a real uploaded/OAuth photo (verified against the
  // real Clerk + Google APIs, see googleHasCustomPhoto on user.entity.ts
  // for the field that actually disambiguates this for Google accounts).
  // Kept here and on User/UserResponseDto as "Clerk has *some* image for
  // this account" - still meaningful for that narrower claim, just never
  // sufficient by itself to mark the profile-completion avatar step done.
  clerkHasImage: boolean | null;
  // Resolved from the account's first externalAccount, if any - see
  // UserService's resolveExternalAccountProvider.
  externalAccountProvider: ExternalAccountProvider | null;
}
