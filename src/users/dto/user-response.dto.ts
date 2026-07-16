import { GlobalRole } from '../../auth/permissions/global-role.enum';
import { Theme } from '../entities/user.entity';

export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  theme: Theme;
  notificationsEnabled: boolean;
  globalRole: GlobalRole;
  createdAt: string;
  updatedAt: string;
}
