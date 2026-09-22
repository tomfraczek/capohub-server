import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { AvatarType } from '../enums/avatar-type.enum';
import { Theme } from '../entities/user.entity';
import { SongCapabilitiesDto } from './song-capabilities.dto';

export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  avatarType: AvatarType;
  avatarUrl: string | null;
  // Only meaningful when avatarType is 'CLERK' - true if avatarUrl is a
  // real uploaded/OAuth-provided photo, false if it is Clerk's own
  // generated initials placeholder (Clerk's imageUrl is never null/empty
  // either way, so the frontend cannot tell the two apart from avatarUrl
  // alone - see user.entity.ts's own comment on this field). null means
  // "not synced from Clerk yet" (only possible for an account that
  // predates this field and hasn't made an authenticated request since -
  // see user.entity.ts). Still means only "Clerk has *some* image for this
  // account" - for a Google account, that includes Google's own
  // auto-generated placeholder, so this alone is no longer sufficient proof
  // of a real photo. See googleHasCustomPhoto below, the field that
  // actually disambiguates that for Google accounts - the frontend's
  // profile-completion avatar step must key off that one, not this one.
  clerkHasImage: boolean | null;
  // Only meaningful when avatarType is 'CLERK' and the account's external
  // account is Google - see user.entity.ts's own comment for the full
  // semantics. true = a real photo (Google People API `photos[0].default:
  // false`), false = Google's own auto-generated placeholder (`default:
  // true`), null = not checked yet / People API failed / not a Google
  // account. The frontend must treat null the same as false, and must
  // never use avatarUrl or clerkHasImage as a substitute for this field.
  googleHasCustomPhoto: boolean | null;
  presetAvatarId: string | null;
  theme: Theme;
  notificationsEnabled: boolean;
  // Regional settings - see user.entity.ts's own comment; set from
  // PATCH /users/me (module: "ustawienia regionalne z poziomu ustawień
  // profilu"), never from Group/Section creation.
  timezone: string;
  currencyCode: string;
  globalRole: GlobalRole;
  // Global Songs-module permissions for this user, derived server-side from
  // globalRole via PermissionService - see song-capabilities.dto.ts. The
  // frontend must read these instead of mapping globalRole to permissions
  // itself.
  songCapabilities: SongCapabilitiesDto;
  // Stable, immutable, non-guessable code identifying this user without
  // revealing their id - e.g. encoded as this user's personal check-in QR
  // code (see events-api.md "Check-in"). Every user has one, generated at
  // account creation (see UserService.findOrCreateFromClerk). Not a secret
  // and never usable as an authorization token on its own.
  publicCode: string | null;
  createdAt: string;
  updatedAt: string;
}
