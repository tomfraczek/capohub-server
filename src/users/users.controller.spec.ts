import { GlobalRole } from '../auth/permissions/global-role.enum';
import { FavoriteSongsService } from '../song-library/favorite-songs.service';
import { LearningStatusService } from '../song-library/learning-status.service';
import { AvatarType } from './enums/avatar-type.enum';
import { UserIdentityService } from './user-identity.service';
import { UserProfileService } from './user-profile.service';
import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';

// Unused by every describe block below - none of these tests exercise the
// profile/formal-group routes (see user-profile.service.spec.ts instead).
const favoriteSongsService = {} as unknown as FavoriteSongsService;
const learningStatusService = {} as unknown as LearningStatusService;
const userProfileService = {} as unknown as UserProfileService;
const userIdentityService = {} as unknown as UserIdentityService;

function buildUser(): User {
  const user = new User();
  user.id = 'user-uuid-1';
  user.clerkUserId = 'user_clerk_1';
  user.email = 'ada@example.com';
  user.displayName = 'Ada Lovelace';
  user.avatarType = AvatarType.CLERK;
  user.avatarUrl = 'https://img.clerk.com/ada.png';
  user.presetAvatarId = null;
  user.publicCode = 'ADA00001';
  user.theme = 'system';
  user.notificationsEnabled = true;
  user.globalRole = GlobalRole.USER;
  user.isActive = true;
  user.lastLoginAt = new Date('2026-07-10T10:00:00.000Z');
  user.createdAt = new Date('2026-01-01T00:00:00.000Z');
  user.updatedAt = new Date('2026-02-01T00:00:00.000Z');
  return user;
}

describe('UsersController', () => {
  describe('getMe', () => {
    it('maps the current user to a UserResponseDto', () => {
      const userService = {} as unknown as UserService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningStatusService,
      );
      const user = buildUser();

      expect(controller.getMe(user)).toEqual({
        id: 'user-uuid-1',
        email: 'ada@example.com',
        displayName: 'Ada Lovelace',
        avatarType: AvatarType.CLERK,
        avatarUrl: 'https://img.clerk.com/ada.png',
        presetAvatarId: null,
        theme: 'system',
        notificationsEnabled: true,
        globalRole: GlobalRole.USER,
        publicCode: 'ADA00001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      });
    });

    it('never exposes clerkUserId, isActive, or lastLoginAt', () => {
      const userService = {} as unknown as UserService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningStatusService,
      );

      const response = controller.getMe(buildUser());

      expect(response).not.toHaveProperty('clerkUserId');
      expect(response).not.toHaveProperty('isActive');
      expect(response).not.toHaveProperty('lastLoginAt');
    });
  });

  describe('updateMe', () => {
    it('delegates to UserService.updateProfile and maps the result', async () => {
      const user = buildUser();
      const updateProfile = jest.fn().mockImplementation((u: User) => {
        u.displayName = 'Updated Name';
        return Promise.resolve(u);
      });
      const userService = { updateProfile } as unknown as UserService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningStatusService,
      );

      const response = await controller.updateMe(user, {
        displayName: 'Updated Name',
      });

      expect(updateProfile).toHaveBeenCalledWith(user, {
        displayName: 'Updated Name',
      });
      expect(response.displayName).toBe('Updated Name');
    });
  });

  describe('setAvatarPreset', () => {
    it('delegates to UserService.setAvatarPreset and maps the result', async () => {
      const user = buildUser();
      const setAvatarPreset = jest.fn().mockImplementation((u: User) => {
        u.avatarType = AvatarType.PRESET;
        u.presetAvatarId = 'berimbau-01';
        u.avatarUrl = null;
        return Promise.resolve(u);
      });
      const userService = { setAvatarPreset } as unknown as UserService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningStatusService,
      );

      const response = await controller.setAvatarPreset(user, {
        presetAvatarId: 'berimbau-01',
      });

      expect(setAvatarPreset).toHaveBeenCalledWith(user, 'berimbau-01');
      expect(response.avatarType).toBe(AvatarType.PRESET);
      expect(response.presetAvatarId).toBe('berimbau-01');
      expect(response.avatarUrl).toBeNull();
    });
  });

  describe('resetAvatarToClerk', () => {
    it('delegates to UserService.resetAvatarToClerk and maps the result', async () => {
      const user = buildUser();
      const resetAvatarToClerk = jest.fn().mockImplementation((u: User) => {
        u.avatarType = AvatarType.CLERK;
        u.avatarUrl = 'https://img.clerk.com/fresh.png';
        u.presetAvatarId = null;
        return Promise.resolve(u);
      });
      const userService = { resetAvatarToClerk } as unknown as UserService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningStatusService,
      );

      const response = await controller.resetAvatarToClerk(user);

      expect(resetAvatarToClerk).toHaveBeenCalledWith(user);
      expect(response.avatarType).toBe(AvatarType.CLERK);
      expect(response.avatarUrl).toBe('https://img.clerk.com/fresh.png');
      expect(response.presetAvatarId).toBeNull();
    });
  });

  describe('deleteMe', () => {
    it('delegates to UserService.deleteAccount', async () => {
      const user = buildUser();
      const deleteAccount = jest.fn().mockResolvedValue(undefined);
      const userService = { deleteAccount } as unknown as UserService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningStatusService,
      );

      await controller.deleteMe(user);

      expect(deleteAccount).toHaveBeenCalledWith(user);
    });
  });

  describe('getFavoriteSongs', () => {
    it('delegates to FavoriteSongsService.listFavoriteSongs and wraps the result in items', async () => {
      const user = buildUser();
      const items = [{ id: 'song-1' }] as never;
      const listFavoriteSongs = jest.fn().mockResolvedValue(items);
      const userService = {} as unknown as UserService;
      const favoritesService = {
        listFavoriteSongs,
      } as unknown as FavoriteSongsService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoritesService,
        learningStatusService,
      );

      const response = await controller.getFavoriteSongs(user);

      expect(listFavoriteSongs).toHaveBeenCalledWith(user.id);
      expect(response).toEqual({ items });
    });
  });

  describe('getLearningSongs', () => {
    it('delegates to LearningStatusService.listLearningSongs and wraps the result in items', async () => {
      const user = buildUser();
      const items = [{ id: 'song-1', learningStatus: 'LEARNING' }] as never;
      const listLearningSongs = jest.fn().mockResolvedValue(items);
      const userService = {} as unknown as UserService;
      const learningService = {
        listLearningSongs,
      } as unknown as LearningStatusService;
      const controller = new UsersController(
        userService,
        userProfileService,
        userIdentityService,
        favoriteSongsService,
        learningService,
      );

      const response = await controller.getLearningSongs(user);

      expect(listLearningSongs).toHaveBeenCalledWith(user.id);
      expect(response).toEqual({ items });
    });
  });
});
