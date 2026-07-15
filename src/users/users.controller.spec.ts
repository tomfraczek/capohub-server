import { UserService } from './user.service';
import { User } from './entities/user.entity';
import { UsersController } from './users.controller';

function buildUser(): User {
  const user = new User();
  user.id = 'user-uuid-1';
  user.clerkUserId = 'user_clerk_1';
  user.email = 'ada@example.com';
  user.firstName = 'Ada';
  user.lastName = 'Lovelace';
  user.imageUrl = 'https://img.clerk.com/ada.png';
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
      const controller = new UsersController(userService);
      const user = buildUser();

      expect(controller.getMe(user)).toEqual({
        id: 'user-uuid-1',
        email: 'ada@example.com',
        firstName: 'Ada',
        lastName: 'Lovelace',
        imageUrl: 'https://img.clerk.com/ada.png',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-02-01T00:00:00.000Z',
      });
    });

    it('never exposes clerkUserId, isActive, or lastLoginAt', () => {
      const userService = {} as unknown as UserService;
      const controller = new UsersController(userService);

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
        u.firstName = 'Updated';
        return Promise.resolve(u);
      });
      const userService = { updateProfile } as unknown as UserService;
      const controller = new UsersController(userService);

      const response = await controller.updateMe(user, {
        firstName: 'Updated',
      });

      expect(updateProfile).toHaveBeenCalledWith(user, {
        firstName: 'Updated',
      });
      expect(response.firstName).toBe('Updated');
    });
  });
});
