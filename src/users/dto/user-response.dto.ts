import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { AvatarType } from '../enums/avatar-type.enum';
import { Theme } from '../entities/user.entity';

export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  avatarType: AvatarType;
  avatarUrl: string | null;
  presetAvatarId: string | null;
  theme: Theme;
  notificationsEnabled: boolean;
  globalRole: GlobalRole;
  // Stable, immutable, non-guessable code identifying this user without
  // revealing their id - e.g. encoded as this user's personal check-in QR
  // code (see events-api.md "Check-in"). Every user has one, generated at
  // account creation (see UserService.findOrCreateFromClerk). Not a secret
  // and never usable as an authorization token on its own.
  publicCode: string | null;
  createdAt: string;
  updatedAt: string;
}
