import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Put,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { uuidSchema } from '../common/validation/uuid.schema';
import { FavoriteSongsListResponseDto } from '../song-library/dto/favorite-songs-list-response.dto';
import { LearningSongsListResponseDto } from '../song-library/dto/learning-songs-list-response.dto';
import { FavoriteSongsService } from '../song-library/favorite-songs.service';
import { LearningStatusService } from '../song-library/learning-status.service';
import { SetAvatarPresetDto } from './dto/set-avatar-preset.schema';
import { FormalGroupResponseDto } from './dto/formal-group-response.dto';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { SetFormalGroupDto } from './dto/set-formal-group.schema';
import { UpdateUserDto } from './dto/update-user.schema';
import { UpdateUserProfileDto } from './dto/update-user-profile.schema';
import type { UserProfileResponseDto } from './dto/user-profile-response.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';
import { UserProfileService } from './user-profile.service';
import { toUserResponseDto } from './user.mapper';
import { UserService } from './user.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly userService: UserService,
    private readonly userProfileService: UserProfileService,
    private readonly favoriteSongsService: FavoriteSongsService,
    private readonly learningStatusService: LearningStatusService,
  ) {}

  @Get('me')
  getMe(@CurrentUser() user: User): UserResponseDto {
    return toUserResponseDto(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(UpdateUserDto.schema)) dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.updateProfile(user, dto);
    return toUserResponseDto(updated);
  }

  // Avatar type/URL/preset are deliberately not settable via PATCH /users/me
  // above - they have their own endpoints below, each enforcing its own
  // invariants (see UserService.setAvatarPreset / resetAvatarToClerk).
  @Put('me/avatar/preset')
  async setAvatarPreset(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(SetAvatarPresetDto.schema))
    dto: SetAvatarPresetDto,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.setAvatarPreset(
      user,
      dto.presetAvatarId,
    );
    return toUserResponseDto(updated);
  }

  @Put('me/avatar/clerk')
  async resetAvatarToClerk(
    @CurrentUser() user: User,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.resetAvatarToClerk(user);
    return toUserResponseDto(updated);
  }

  @Delete('me')
  @HttpCode(204)
  async deleteMe(@CurrentUser() user: User): Promise<void> {
    await this.userService.deleteAccount(user);
  }

  @Get('me/favorite-songs')
  async getFavoriteSongs(
    @CurrentUser() user: User,
  ): Promise<FavoriteSongsListResponseDto> {
    const items = await this.favoriteSongsService.listFavoriteSongs(user.id);
    return { items };
  }

  @Get('me/learning-songs')
  async getLearningSongs(
    @CurrentUser() user: User,
  ): Promise<LearningSongsListResponseDto> {
    const items = await this.learningStatusService.listLearningSongs(user.id);
    return { items };
  }

  @Get('me/profile')
  getMyProfile(@CurrentUser() user: User): Promise<UserProfileResponseDto> {
    return this.userProfileService.getOwnProfile(user);
  }

  @Patch('me/profile')
  updateMyProfile(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(UpdateUserProfileDto.schema))
    dto: UpdateUserProfileDto,
  ): Promise<UserProfileResponseDto> {
    return this.userProfileService.updateOwnProfile(user, dto);
  }

  @Put('me/formal-group')
  setMyFormalGroup(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(SetFormalGroupDto.schema))
    dto: SetFormalGroupDto,
  ): Promise<FormalGroupResponseDto> {
    return this.userProfileService.setFormalGroup(
      user,
      dto.groupId,
      dto.startedOn,
    );
  }

  @Delete('me/formal-group')
  @HttpCode(204)
  endMyFormalGroup(@CurrentUser() user: User): Promise<void> {
    return this.userProfileService.endFormalGroup(user);
  }

  // Declared after every `me/*` route above - route-registration order
  // matters here, since `:userId` would otherwise also match "me".
  @Get(':userId/profile')
  getPublicProfile(
    @CurrentUser() viewer: User,
    @Param('userId') userId: string,
  ): Promise<PublicUserProfileResponseDto> {
    if (!uuidSchema.safeParse(userId).success) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    return this.userProfileService.getPublicProfile(viewer, userId);
  }
}
