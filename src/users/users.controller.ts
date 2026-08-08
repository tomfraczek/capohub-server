import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { normalizeNumericCodeInput } from '../common/utils/numeric-code';
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
import {
  userSearchQuerySchema,
  UserSearchQueryDto,
} from './dto/user-search-query.schema';
import type { UserSearchListResponseDto } from './dto/user-search-result.dto';
import type { UserProfileResponseDto } from './dto/user-profile-response.dto';
import type { UserResponseDto } from './dto/user-response.dto';
import { User } from './entities/user.entity';
import { UserIdentityService } from './user-identity.service';
import { UserProfileService } from './user-profile.service';
import { toUserResponseDto } from './user.mapper';
import { UserService } from './user.service';

@Controller('users')
export class UsersController {
  constructor(
    private readonly userService: UserService,
    private readonly userProfileService: UserProfileService,
    private readonly userIdentityService: UserIdentityService,
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

  // Declared after every `me/*` route, and before `:userId/profile` below -
  // route-registration order matters here, since `:userId` would otherwise
  // also match "by-code". Accepts either the raw 6-digit code or the
  // frontend's "123-456" display format (see normalizeNumericCodeInput);
  // the response is the same privacy-filtered PublicUserProfileResponseDto
  // GET /users/:userId/profile returns - knowing the code never bypasses
  // the target's own privacy toggles (module spec §9).
  @Get('by-code/:code')
  async getByCode(
    @CurrentUser() viewer: User,
    @Param('code') code: string,
  ): Promise<PublicUserProfileResponseDto> {
    const numericCode = normalizeNumericCodeInput(code);
    if (!numericCode) {
      throw new BadRequestException({
        code: 'INVALID_NUMERIC_CODE',
        message: 'code must be exactly 6 digits',
      });
    }
    const target =
      await this.userIdentityService.resolveUserByNumericCode(numericCode);
    if (!target) {
      throw new NotFoundException({
        code: 'USER_NOT_FOUND',
        message: 'User not found',
      });
    }
    return this.userProfileService.getPublicProfile(viewer, target.id);
  }

  // No route-ordering hazard here (unlike "by-code" above) - "search" is a
  // single static segment with no same-shape dynamic route in this
  // controller to collide with. A neutral picker for Trainings'
  // external-trainer flow (see UserProfileService.searchUsers) -
  // deliberately lives on UsersController rather than in TrainingsModule,
  // since TrainingsModule already validates any submitted trainerUserId
  // independently and UsersModule must never import TrainingsModule back.
  @Get('search')
  search(
    @Query(new ZodValidationPipe(userSearchQuerySchema))
    query: UserSearchQueryDto,
  ): Promise<UserSearchListResponseDto> {
    return this.userProfileService.searchUsers(
      query.search,
      query.limit,
      query.offset,
    );
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
