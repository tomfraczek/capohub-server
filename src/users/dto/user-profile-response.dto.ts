export interface UserProfilePrivacyDto {
  showFullName: boolean;
  showApelido: boolean;
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
  capoeiraStartedAt: string | null;
  // true only once both firstName and lastName have been set - never
  // reverts to false afterwards, since UpdateUserProfileDto never allows
  // clearing either back to null. Backend-only signal: no endpoint in this
  // stage is gated on it - enforcing an onboarding flow off this field is
  // frontend work, out of scope here.
  profileComplete: boolean;
  privacy: UserProfilePrivacyDto;
  formalGroup: OwnFormalGroupRefDto | null;
  // Stable 6-digit code (see entities/user.entity.ts) - exposed on the
  // *own* profile only, not on PublicUserProfileResponseDto (see that
  // DTO's own comment for why). Not a secret.
  numericCode: string;
  // "<PUBLIC_WEB_BASE_URL>/u/<numericCode>" - a real, public https:// link,
  // the exact string the frontend encodes as this User's QR identity (see
  // common/identity/qr-payload.util.ts) - scanning it with an ordinary
  // camera app opens straight to this User's profile. Never contains the
  // user's UUID, email, or name. `null` when PUBLIC_WEB_BASE_URL isn't
  // configured yet - never a fabricated placeholder domain or a fallback
  // deep-link format; the frontend ("Mój kod") must render a "not
  // configured" state for this case, not attempt to show a broken QR.
  qrPayload: string | null;
}
