import { Theme } from '../entities/user.entity';

export interface UserResponseDto {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  theme: Theme;
  notificationsEnabled: boolean;
  createdAt: string;
  updatedAt: string;
}
