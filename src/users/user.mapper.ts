import { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';

// clerkUserId, isActive and lastLoginAt are deliberately not exposed here.
export function toUserResponseDto(user: User): UserResponseDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    imageUrl: user.imageUrl,
    createdAt: user.createdAt.toISOString(),
    updatedAt: user.updatedAt.toISOString(),
  };
}
