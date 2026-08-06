export interface PublicSectionRefDto {
  id: string;
  name: string;
}

export interface PublicFormalGroupRefDto {
  id: string;
  name: string;
}

// GET /users/:userId/profile - filtered per-viewer according to the
// target's privacy toggles and, for firstName/lastName only, the extra
// exact-Section-admin/Event-organizer rule (see UserProfileService). Every
// field below is `null` exactly when it is not visible to the requesting
// viewer - the client never receives a value it isn't allowed to see.
//
// No `groups` field - a Group has no membership, so the only thing such a
// list could show is which Groups this user administers (OWNER/ADMIN
// RoleAssignment), and surfacing that here would leak an administrative
// fact through a field that reads as ordinary membership. `sections` is
// membership only - no role or membership-status data.
export interface PublicUserProfileResponseDto {
  userId: string;
  // Safe, privacy-respecting label - see UserProfileMapper.resolveDisplayName.
  displayName: string;
  firstName: string | null;
  lastName: string | null;
  apelido: string | null;
  city: string | null;
  country: string | null;
  capoeiraStartedAt: string | null;
  sections: PublicSectionRefDto[] | null;
  formalGroup: PublicFormalGroupRefDto | null;
}
