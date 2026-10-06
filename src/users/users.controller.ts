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
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { PermissionService } from '../auth/permissions/permission.service';
import { UserCheckInIdentityService } from '../common/identity/user-check-in-identity.service';
import { normalizeNumericCodeInput } from '../common/utils/numeric-code';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { uuidSchema } from '../common/validation/uuid.schema';
import { FavoriteSongsListResponseDto } from '../song-library/dto/favorite-songs-list-response.dto';
import { LearningSongsListResponseDto } from '../song-library/dto/learning-songs-list-response.dto';
import { FavoriteSongsService } from '../song-library/favorite-songs.service';
import { LearningStatusService } from '../song-library/learning-status.service';
import {
  assertImageFilePresent,
  imageUploadInterceptor,
} from '../storage/multer-image.interceptor';
import { R2StorageService } from '../storage/r2-storage.service';
import { SetAvatarPresetDto } from './dto/set-avatar-preset.schema';
import {
  FormalGroupResponseDto,
  PendingFormalGroupRequestResponseDto,
} from './dto/formal-group-response.dto';
import { PublicUserProfileResponseDto } from './dto/public-user-profile-response.dto';
import { SetFormalGroupDto } from './dto/set-formal-group.schema';
import { buildSongCapabilities } from './dto/song-capabilities.dto';
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
    private readonly permissionService: PermissionService,
    private readonly r2StorageService: R2StorageService,
    private readonly userCheckInIdentityService: UserCheckInIdentityService,
  ) {}

  // Shared by every route below that returns a UserResponseDto - keeps
  // songCapabilities computed in exactly one place (see
  // song-capabilities.dto.ts), rather than re-deriving it at each call
  // site.
  private toResponseDto(user: User): UserResponseDto {
    return toUserResponseDto(
      user,
      buildSongCapabilities(user.globalRole, this.permissionService),
      this.r2StorageService,
    );
  }

  @Get('me')
  getMe(@CurrentUser() user: User): UserResponseDto {
    return this.toResponseDto(user);
  }

  @Patch('me')
  async updateMe(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(UpdateUserDto.schema)) dto: UpdateUserDto,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.updateProfile(user, dto);
    return this.toResponseDto(updated);
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
    return this.toResponseDto(updated);
  }

  @Put('me/avatar/clerk')
  async resetAvatarToClerk(
    @CurrentUser() user: User,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.resetAvatarToClerk(user);
    return this.toResponseDto(updated);
  }

  // PUT /users/me/profile-image (module: "R2: upload/replace/delete zdjęć"
  // §16) - uploads/replaces this User's own R2-hosted avatar. Auth-only,
  // same as every other me/* route - `userId` is never accepted from the
  // client (module spec §17), only ever `@CurrentUser()`.
  @Put('me/profile-image')
  @UseInterceptors(imageUploadInterceptor())
  async uploadProfileImage(
    @CurrentUser() user: User,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<UserResponseDto> {
    assertImageFilePresent(file);
    const updated = await this.userService.uploadAvatar(user, file);
    return this.toResponseDto(updated);
  }

  @Delete('me/profile-image')
  async deleteProfileImage(
    @CurrentUser() user: User,
  ): Promise<UserResponseDto> {
    const updated = await this.userService.deleteAvatar(user);
    return this.toResponseDto(updated);
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

  // 200 + FormalGroupResponseDto when set immediately; 202 +
  // PendingFormalGroupRequestResponseDto when the Group requires approval
  // and a join request was sent instead (see UserProfileService.setFormalGroup).
  @Put('me/formal-group')
  async setMyFormalGroup(
    @CurrentUser() user: User,
    @Body(new ZodValidationPipe(SetFormalGroupDto.schema))
    dto: SetFormalGroupDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FormalGroupResponseDto | PendingFormalGroupRequestResponseDto> {
    const result = await this.userProfileService.setFormalGroup(
      user,
      dto.groupId,
      dto.startedOn,
    );
    if ('pendingRequest' in result) {
      response.status(202);
    }
    return result;
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

  // No route-ordering hazard (same reasoning as "search" above) - a single
  // static segment, no same-shape dynamic route to collide with. Reuses
  // UserCheckInIdentityService verbatim (module: "not a secret, not a
  // token" QR/numericCode contract) rather than a second identity parser -
  // the very same numeric-code / "U123-456" / QR-payload input shapes
  // check-in already accepts, just for a different purpose (profile
  // lookup, open to any authenticated user - no check-in permission
  // gating here at all). Returns only `userId` - never the profile itself,
  // so a scanned/typed identity never bypasses the target's own privacy
  // toggles; the caller still fetches the real (privacy-filtered) data via
  // GET /:userId/profile below.
  @Get('resolve-identity')
  async resolveIdentity(
    @Query('identity') identity: string | undefined,
  ): Promise<{ userId: string }> {
    if (!identity || identity.trim().length === 0) {
      throw new BadRequestException({
        code: 'INVALID_CHECK_IN_IDENTITY',
        message:
          'identity must be a 6-digit numeric code or a valid User QR payload',
      });
    }
    const { user } = await this.userCheckInIdentityService.resolve(identity);
    return { userId: user.id };
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
