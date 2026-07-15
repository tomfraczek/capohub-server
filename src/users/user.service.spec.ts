import { EntityManager, EntityRepository } from '@mikro-orm/core';
import type { ClerkClient } from '@clerk/backend';
import { AuthContext } from '../auth/types/auth-context.type';
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
    firstName: 'Ada',
    lastName: 'Lovelace',
    imageUrl: 'https://img.clerk.com/ada.png',
    primaryEmailAddress: { emailAddress: 'Ada@Example.com' },
    ...overrides,
  };
}

describe('UserService', () => {
  function buildService(options: {
    findOne?: jest.Mock;
    getUser?: jest.Mock;
  }): {
    service: UserService;
    em: { flush: jest.Mock; persistAndFlush: jest.Mock };
    userRepository: { findOne: jest.Mock };
  } {
    const em = {
      flush: jest.fn().mockResolvedValue(undefined),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
    };
    const userRepository = {
      findOne: options.findOne ?? jest.fn().mockResolvedValue(null),
    };
    const clerkClient = {
      users: {
        getUser:
          options.getUser ?? jest.fn().mockResolvedValue(buildClerkUser()),
      },
    };

    const service = new UserService(
      em as unknown as EntityManager,
      userRepository as unknown as EntityRepository<User>,
      clerkClient as unknown as ClerkClient,
    );

    return { service, em, userRepository };
  }

  describe('findOrCreateFromClerk', () => {
    it('creates a new local User when none exists yet', async () => {
      const { service, em } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user).toBeInstanceOf(User);
      expect(user.clerkUserId).toBe('user_clerk_1');
      expect(user.email).toBe('ada@example.com');
      expect(user.firstName).toBe('Ada');
      expect(user.lastName).toBe('Lovelace');
      expect(user.imageUrl).toBe('https://img.clerk.com/ada.png');
      expect(em.persistAndFlush).toHaveBeenCalledWith(user);
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

    it('updates changed email/imageUrl for an existing user, but never firstName/lastName', async () => {
      // firstName/lastName are locally owned once a user exists (editable
      // via PATCH /users/me) - only email/imageUrl keep syncing from Clerk.
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'old@example.com';
      existing.firstName = 'Local Edit';
      existing.lastName = 'Kept As Is';
      existing.imageUrl = 'https://img.clerk.com/old.png';

      const { service, em } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user).toBe(existing);
      expect(user.email).toBe('ada@example.com');
      expect(user.imageUrl).toBe('https://img.clerk.com/ada.png');
      expect(user.firstName).toBe('Local Edit');
      expect(user.lastName).toBe('Kept As Is');
      expect(em.flush).toHaveBeenCalled();
      expect(em.persistAndFlush).not.toHaveBeenCalled();
    });

    it('leaves fields untouched and still updates lastLoginAt when nothing changed', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada@example.com';
      existing.firstName = 'Ada';
      existing.lastName = 'Lovelace';
      existing.imageUrl = 'https://img.clerk.com/ada.png';
      existing.lastLoginAt = new Date('2020-01-01T00:00:00.000Z');

      const { service, em } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.email).toBe('ada@example.com');
      expect(user.imageUrl).toBe('https://img.clerk.com/ada.png');
      expect(user.lastLoginAt?.getTime()).toBeGreaterThan(
        new Date('2020-01-01T00:00:00.000Z').getTime(),
      );
      expect(em.flush).toHaveBeenCalledTimes(1);
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

  describe('updateProfile', () => {
    it('updates firstName and lastName', async () => {
      const user = new User();
      user.firstName = 'Old';
      user.lastName = 'Name';
      const { service, em } = buildService({});

      const updated = await service.updateProfile(user, {
        firstName: 'New',
        lastName: 'Value',
      });

      expect(updated.firstName).toBe('New');
      expect(updated.lastName).toBe('Value');
      expect(em.flush).toHaveBeenCalled();
    });

    it('clears a field when given null', async () => {
      const user = new User();
      user.firstName = 'Old';
      const { service } = buildService({});

      const updated = await service.updateProfile(user, { firstName: null });

      expect(updated.firstName).toBeNull();
    });

    it('leaves a field untouched when omitted (undefined)', async () => {
      const user = new User();
      user.firstName = 'Keep';
      user.lastName = 'Me';
      const { service } = buildService({});

      const updated = await service.updateProfile(user, {
        firstName: 'Changed',
      });

      expect(updated.firstName).toBe('Changed');
      expect(updated.lastName).toBe('Me');
    });
  });
});
