import { EntityManager, EntityRepository } from '@mikro-orm/core';
import type { ClerkClient } from '@clerk/backend';
import { AuthContext } from '../auth/types/auth-context.type';
import { GlobalRole } from '../auth/permissions/global-role.enum';
import { User } from './entities/user.entity';
import { UserService } from './user.service';

function buildAuth(userId = 'user_clerk_1'): AuthContext {
  return {
    userId,
    sessionId: 'sess_1',
    tokenType: 'session_token',
    claims: { sub: userId, sid: 'sess_1' },
  };
}

function buildClerkUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 'user_clerk_1',
    imageUrl: 'https://img.clerk.com/ada.png',
    primaryEmailAddress: { emailAddress: 'Ada.Lovelace@Example.com' },
    ...overrides,
  };
}

describe('UserService', () => {
  function buildService(options: {
    findOne?: jest.Mock;
    getUser?: jest.Mock;
    deleteUser?: jest.Mock;
  }): {
    service: UserService;
    em: {
      flush: jest.Mock;
      persistAndFlush: jest.Mock;
      removeAndFlush: jest.Mock;
    };
    userRepository: { findOne: jest.Mock };
    clerkClient: { users: { getUser: jest.Mock; deleteUser: jest.Mock } };
  } {
    const em = {
      flush: jest.fn().mockResolvedValue(undefined),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
      removeAndFlush: jest.fn().mockResolvedValue(undefined),
    };
    const userRepository = {
      findOne: options.findOne ?? jest.fn().mockResolvedValue(null),
    };
    const clerkClient = {
      users: {
        getUser:
          options.getUser ?? jest.fn().mockResolvedValue(buildClerkUser()),
        deleteUser:
          options.deleteUser ?? jest.fn().mockResolvedValue(undefined),
      },
    };

    const service = new UserService(
      em as unknown as EntityManager,
      userRepository as unknown as EntityRepository<User>,
      clerkClient as unknown as ClerkClient,
    );

    return { service, em, userRepository, clerkClient };
  }

  describe('findOrCreateFromClerk', () => {
    it('creates a new local User when none exists yet', async () => {
      const { service, em } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user).toBeInstanceOf(User);
      expect(user.clerkUserId).toBe('user_clerk_1');
      expect(user.email).toBe('ada.lovelace@example.com');
      expect(user.avatarUrl).toBe('https://img.clerk.com/ada.png');
      expect(em.persistAndFlush).toHaveBeenCalledWith(user);
    });

    it('generates displayName from the email local part on create', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.displayName).toBe('Ada Lovelace');
    });

    it('defaults theme to system and notificationsEnabled to true on create', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.theme).toBe('system');
      expect(user.notificationsEnabled).toBe(true);
    });

    it('defaults globalRole to USER on create', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.globalRole).toBe(GlobalRole.USER);
    });

    it('never changes globalRole for an existing user', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada.lovelace@example.com';
      existing.displayName = 'Ada Lovelace';
      existing.avatarUrl = 'https://img.clerk.com/ada.png';
      existing.globalRole = GlobalRole.ADMIN;

      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.globalRole).toBe(GlobalRole.ADMIN);
    });

    it('sets lastLoginAt when creating a new user', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const before = Date.now();
      const user = await service.findOrCreateFromClerk(buildAuth());
      const after = Date.now();

      expect(user.lastLoginAt).not.toBeNull();
      expect(user.lastLoginAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(user.lastLoginAt?.getTime()).toBeLessThanOrEqual(after);
    });

    it('lowercases and trims the email from Clerk on create', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
        getUser: jest.fn().mockResolvedValue(
          buildClerkUser({
            primaryEmailAddress: { emailAddress: '  Ada@EXAMPLE.com  ' },
          }),
        ),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.email).toBe('ada@example.com');
    });

    it('updates changed email/avatarUrl for an existing user, but never displayName', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'old@example.com';
      existing.displayName = 'My Custom Name';
      existing.avatarUrl = 'https://img.clerk.com/old.png';

      const { service, em } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user).toBe(existing);
      expect(user.email).toBe('ada.lovelace@example.com');
      expect(user.avatarUrl).toBe('https://img.clerk.com/ada.png');
      expect(user.displayName).toBe('My Custom Name');
      expect(em.flush).toHaveBeenCalled();
      expect(em.persistAndFlush).not.toHaveBeenCalled();
    });

    it('does not update lastLoginAt for an existing user (login-only, not activity)', async () => {
      const originalLastLoginAt = new Date('2020-01-01T00:00:00.000Z');
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada.lovelace@example.com';
      existing.displayName = 'Ada Lovelace';
      existing.avatarUrl = 'https://img.clerk.com/ada.png';
      existing.lastLoginAt = originalLastLoginAt;

      const { service, em } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.lastLoginAt).toBe(originalLastLoginAt);
      expect(em.flush).toHaveBeenCalledTimes(1);
    });

    it('leaves email/avatarUrl untouched when nothing changed', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada.lovelace@example.com';
      existing.displayName = 'Ada Lovelace';
      existing.avatarUrl = 'https://img.clerk.com/ada.png';

      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.email).toBe('ada.lovelace@example.com');
      expect(user.avatarUrl).toBe('https://img.clerk.com/ada.png');
    });

    it('looks up the existing user by clerkUserId', async () => {
      const findOne = jest.fn().mockResolvedValue(null);
      const { service } = buildService({ findOne });

      await service.findOrCreateFromClerk(buildAuth('user_clerk_42'));

      expect(findOne).toHaveBeenCalledWith({ clerkUserId: 'user_clerk_42' });
    });

    it('throws when Clerk has no primary email for the user', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
        getUser: jest
          .fn()
          .mockResolvedValue(buildClerkUser({ primaryEmailAddress: null })),
      });

      await expect(
        service.findOrCreateFromClerk(buildAuth()),
      ).rejects.toThrow();
    });
  });

  describe('deleteAccount', () => {
    it('deletes the Clerk account before removing the local user', async () => {
      const user = new User();
      user.clerkUserId = 'user_clerk_1';
      const calls: string[] = [];

      const deleteUser = jest.fn().mockImplementation(() => {
        calls.push('clerk');
        return Promise.resolve();
      });
      const { service, em } = buildService({ deleteUser });
      em.removeAndFlush.mockImplementation(() => {
        calls.push('local');
        return Promise.resolve();
      });

      await service.deleteAccount(user);

      expect(deleteUser).toHaveBeenCalledWith('user_clerk_1');
      expect(em.removeAndFlush).toHaveBeenCalledWith(user);
      expect(calls).toEqual(['clerk', 'local']);
    });
  });

  describe('updateProfile', () => {
    it('updates displayName', async () => {
      const user = new User();
      user.displayName = 'Old Name';
      const { service, em } = buildService({});

      const updated = await service.updateProfile(user, {
        displayName: 'New Name',
      });

      expect(updated.displayName).toBe('New Name');
      expect(em.flush).toHaveBeenCalled();
    });

    it('updates theme', async () => {
      const user = new User();
      const { service } = buildService({});

      const updated = await service.updateProfile(user, { theme: 'dark' });

      expect(updated.theme).toBe('dark');
    });

    it('updates notificationsEnabled', async () => {
      const user = new User();
      const { service } = buildService({});

      const updated = await service.updateProfile(user, {
        notificationsEnabled: false,
      });

      expect(updated.notificationsEnabled).toBe(false);
    });

    it('leaves fields untouched when omitted (undefined)', async () => {
      const user = new User();
      user.displayName = 'Keep Me';
      user.theme = 'light';
      user.notificationsEnabled = false;
      const { service } = buildService({});

      const updated = await service.updateProfile(user, { theme: 'dark' });

      expect(updated.displayName).toBe('Keep Me');
      expect(updated.theme).toBe('dark');
      expect(updated.notificationsEnabled).toBe(false);
    });

    it('never touches email or avatarUrl', async () => {
      const user = new User();
      user.email = 'untouched@example.com';
      user.avatarUrl = 'https://img.clerk.com/untouched.png';
      const { service } = buildService({});

      const updated = await service.updateProfile(user, {
        displayName: 'New Name',
      });

      expect(updated.email).toBe('untouched@example.com');
      expect(updated.avatarUrl).toBe('https://img.clerk.com/untouched.png');
    });

    it('never changes globalRole, even if present in the input object', async () => {
      const user = new User();
      user.globalRole = GlobalRole.USER;
      const { service } = buildService({});

      // updateProfile()'s parameter type has no globalRole field at all - this
      // cast simulates a caller trying to sneak it in anyway.
      const maliciousChanges = {
        displayName: 'New Name',
        globalRole: GlobalRole.SUPER_ADMIN,
      } as unknown as Parameters<typeof service.updateProfile>[1];

      const updated = await service.updateProfile(user, maliciousChanges);

      expect(updated.globalRole).toBe(GlobalRole.USER);
    });
  });
});
