export interface UserProfilePrivacyDto {
  showFullName: boolean;
  showApelido: boolean;
  showLocation: boolean;
  showCapoeiraStartedAt: boolean;
  showSections: boolean;
  showFormalGroup: boolean;
  showFormalRank: boolean;
  showCareerTimeline: boolean;
  showEventParticipation: boolean;
}

export interface OwnFormalGroupRefDto {
  groupId: string;
  name: string;
  startedOn: string | null;
  endedOn: string | null;
}

// GET/PATCH /users/me/profile - the caller's own profile, unfiltered by
// any privacy toggle (those toggles only affect what *other* viewers see -
// see PublicUserProfileResponseDto). Never the raw User entity - see
// UserProfileMapper.
export interface UserProfileResponseDto {
  userId: string;
  firstName: string | null;
  lastName: string | null;
  apelido: string | null;
  city: string | null;
  country: string | null;
  capoeiraStartedAt: string | null;
  // true only once both firstName and lastName have been set - never
  // reverts to false afterwards, since UpdateUserProfileDto never allows
  // clearing either back to null. Backend-only signal: no endpoint in this
  // stage is gated on it - enforcing an onboarding flow off this field is
  // frontend work, out of scope here.
  profileComplete: boolean;
  privacy: UserProfilePrivacyDto;
  formalGroup: OwnFormalGroupRefDto | null;
}
