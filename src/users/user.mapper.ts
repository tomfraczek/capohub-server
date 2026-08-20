import { UserResponseDto } from './dto/user-response.dto';
import { SongCapabilitiesDto } from './dto/song-capabilities.dto';
import { User } from './entities/user.entity';

// clerkUserId, isActive and lastLoginAt are deliberately not exposed here.
export function toUserResponseDto(
  user: User,
  songCapabilities: SongCapabilitiesDto,
): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarType: user.avatarType,
    avatarUrl: user.avatarUrl,
    presetAvatarId: user.presetAvatarId,
    theme: user.theme,
    notificationsEnabled: user.notificationsEnabled,
    globalRole: user.globalRole,
    songCapabilities,
    publicCode: user.publicCode,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
