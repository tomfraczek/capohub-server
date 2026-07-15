import { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';

// clerkUserId, isActive and lastLoginAt are deliberately not exposed here.
export function toUserResponseDto(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    theme: user.theme,
    notificationsEnabled: user.notificationsEnabled,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
