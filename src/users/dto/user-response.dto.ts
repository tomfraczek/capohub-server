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
  createdAt: string;
  updatedAt: string;
}
