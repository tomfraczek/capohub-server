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
