import {
  PublicUrlBuilder,
  resolveUserAvatarUrl,
} from '../storage/image-url.util';
import { UserResponseDto } from './dto/user-response.dto';
import { SongCapabilitiesDto } from './dto/song-capabilities.dto';
import { User } from './entities/user.entity';

// clerkUserId, isActive and lastLoginAt are deliberately not exposed here.
export function toUserResponseDto(
  user: User,
  songCapabilities: SongCapabilitiesDto,
  urlBuilder: PublicUrlBuilder,
): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarType: user.avatarType,
    // Prefers the R2 public URL derived from avatarImageKey over the plain
    // avatarUrl column once an UPLOAD avatar exists - see
    // storage/image-url.util.ts's resolveUserAvatarUrl.
    avatarUrl: resolveUserAvatarUrl(user, urlBuilder),
    clerkHasImage: user.clerkHasImage,
    presetAvatarId: user.presetAvatarId,
    theme: user.theme,
    notificationsEnabled: user.notificationsEnabled,
    timezone: user.timezone,
    currencyCode: user.currencyCode,
    globalRole: user.globalRole,
    songCapabilities,
    publicCode: user.publicCode,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
