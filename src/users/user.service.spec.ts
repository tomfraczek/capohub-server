import { ConflictException } from '@nestjs/common';
import { EntityManager, EntityRepository } from '@mikro-orm/postgresql';
import type { ClerkClient } from '@clerk/backend';
import { AuthContext } from '../auth/types/auth-context.type';
import { GlobalRole } from '../auth/permissions/global-role.enum';
import { GroupMembership } from '../groups/entities/group-membership.entity';
import { Group } from '../groups/entities/group.entity';
import { RoleAssignment } from '../groups/entities/role-assignment.entity';
import { RoleAssignmentsService } from '../groups/role-assignments.service';
import { AvatarType } from './enums/avatar-type.enum';
import { User } from './entities/user.entity';
import { UserService } from './user.service';

function buildMembership(overrides: Partial<GroupMembership> = {}) {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.rootGroup = { id: 'root-1' } as never;
  return Object.assign(membership, overrides);
}

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
    findMemberships?: jest.Mock;
    findOwnedActiveGroups?: jest.Mock;
    nativeDelete?: jest.Mock;
    findOneOrFailUser?: jest.Mock;
  }): {
    service: UserService;
    em: {
      flush: jest.Mock;
      persistAndFlush: jest.Mock;
      find: jest.Mock;
      findOneOrFail: jest.Mock;
      nativeDelete: jest.Mock;
      transactional: jest.Mock;
    };
    userRepository: { findOne: jest.Mock };
    clerkClient: { users: { getUser: jest.Mock; deleteUser: jest.Mock } };
    roleAssignmentsService: { findOwnedActiveGroups: jest.Mock };
  } {
    const em: Record<string, jest.Mock> = {
      flush: jest.fn().mockResolvedValue(undefined),
      persistAndFlush: jest.fn().mockResolvedValue(undefined),
      find: options.findMemberships ?? jest.fn().mockResolvedValue([]),
      findOneOrFail:
        options.findOneOrFailUser ?? jest.fn().mockResolvedValue(new User()),
      nativeDelete: options.nativeDelete ?? jest.fn().mockResolvedValue(0),
    };
    em.transactional = jest
      .fn()
      .mockImplementation((cb: (em: unknown) => unknown) => cb(em));
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
    const roleAssignmentsService = {
      findOwnedActiveGroups:
        options.findOwnedActiveGroups ?? jest.fn().mockResolvedValue([]),
    };

    const service = new UserService(
      em as unknown as EntityManager,
      userRepository as unknown as EntityRepository<User>,
      clerkClient as unknown as ClerkClient,
      roleAssignmentsService as unknown as RoleAssignmentsService,
    );

    return {
      service,
      em: em as never,
      userRepository,
      clerkClient,
      roleAssignmentsService,
    };
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

    it('sets avatarType CLERK, avatarUrl and null presetAvatarId when Clerk returns an imageUrl', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.avatarType).toBe(AvatarType.CLERK);
      expect(user.avatarUrl).toBe('https://img.clerk.com/ada.png');
      expect(user.presetAvatarId).toBeNull();
    });

    it('sets avatarType CLERK and null avatarUrl/presetAvatarId when Clerk has no imageUrl', async () => {
      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(null),
        getUser: jest
          .fn()
          .mockResolvedValue(buildClerkUser({ imageUrl: null })),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.avatarType).toBe(AvatarType.CLERK);
      expect(user.avatarUrl).toBeNull();
      expect(user.presetAvatarId).toBeNull();
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

    it('syncs avatarUrl from Clerk for an existing user with avatarType CLERK', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada.lovelace@example.com';
      existing.displayName = 'Ada Lovelace';
      existing.avatarType = AvatarType.CLERK;
      existing.avatarUrl = 'https://img.clerk.com/old.png';

      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.avatarType).toBe(AvatarType.CLERK);
      expect(user.avatarUrl).toBe('https://img.clerk.com/ada.png');
    });

    it('does not overwrite avatarUrl for an existing user with avatarType UPLOAD', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada.lovelace@example.com';
      existing.displayName = 'Ada Lovelace';
      existing.avatarType = AvatarType.UPLOAD;
      existing.avatarUrl = 'https://uploads.capohub.app/ada.png';

      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.avatarType).toBe(AvatarType.UPLOAD);
      expect(user.avatarUrl).toBe('https://uploads.capohub.app/ada.png');
    });

    it('does not overwrite presetAvatarId/avatarUrl for an existing user with avatarType PRESET', async () => {
      const existing = new User();
      existing.clerkUserId = 'user_clerk_1';
      existing.email = 'ada.lovelace@example.com';
      existing.displayName = 'Ada Lovelace';
      existing.avatarType = AvatarType.PRESET;
      existing.presetAvatarId = 'berimbau-01';
      existing.avatarUrl = null;

      const { service } = buildService({
        findOne: jest.fn().mockResolvedValue(existing),
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const user = await service.findOrCreateFromClerk(buildAuth());

      expect(user.avatarType).toBe(AvatarType.PRESET);
      expect(user.presetAvatarId).toBe('berimbau-01');
      expect(user.avatarUrl).toBeNull();
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
    function buildUser(): User {
      const user = new User();
      user.id = 'user-1';
      user.clerkUserId = 'user_clerk_1';
      return user;
    }

    // Tracks every nativeDelete/deleteUser call in invocation order, keyed
    // by what was deleted - used to assert both ordering (local before
    // Clerk, RoleAssignments before Memberships before the User row) and
    // that each step actually ran.
    function buildTrackedEm(deleteUser: jest.Mock) {
      const calls: string[] = [];
      const nativeDelete = jest.fn((entity: unknown) => {
        if (entity === RoleAssignment) calls.push('roleAssignments');
        else if (entity === GroupMembership) calls.push('memberships');
        else if (entity === User) calls.push('user');
        return Promise.resolve(0);
      });
      deleteUser.mockImplementation(() => {
        calls.push('clerk');
        return Promise.resolve();
      });
      return { calls, nativeDelete };
    }

    it('allows a user with no Membership at all to delete the account', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const { service, roleAssignmentsService } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([]),
      });

      await service.deleteAccount(buildUser());

      expect(roleAssignmentsService.findOwnedActiveGroups).not.toHaveBeenCalled();
      // No Memberships - nothing to wipe besides the User row itself.
      expect(calls).toEqual(['user', 'clerk']);
    });

    it('allows a user with a Membership but no RoleAssignment to delete the account', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
      });

      await service.deleteAccount(buildUser());

      expect(calls).toEqual(['roleAssignments', 'memberships', 'user', 'clerk']);
    });

    it('allows a user holding MEMBER to delete the account', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
        // Holding MEMBER (or any non-OWNER Role) never shows up as an
        // owned Group - only OWNER RoleAssignments do (see
        // RoleAssignmentsService.findOwnedActiveGroups).
        findOwnedActiveGroups: jest.fn().mockResolvedValue([]),
      });

      await service.deleteAccount(buildUser());

      expect(calls).toEqual(['roleAssignments', 'memberships', 'user', 'clerk']);
    });

    it('allows a user holding MEMBER + INSTRUCTOR + ADMIN for the same Group to delete the account', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
        findOwnedActiveGroups: jest.fn().mockResolvedValue([]),
      });

      await service.deleteAccount(buildUser());

      expect(calls).toEqual(['roleAssignments', 'memberships', 'user', 'clerk']);
    });

    it('allows a user belonging to several Organizations to delete the account, checking ownership once per Membership', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const memberships = [
        buildMembership({ id: 'membership-1', rootGroup: { id: 'root-1' } as never }),
        buildMembership({ id: 'membership-2', rootGroup: { id: 'root-2' } as never }),
        buildMembership({ id: 'membership-3', rootGroup: { id: 'root-3' } as never }),
      ];
      const findOwnedActiveGroups = jest.fn().mockResolvedValue([]);
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue(memberships),
        findOwnedActiveGroups,
      });

      await service.deleteAccount(buildUser());

      expect(findOwnedActiveGroups).toHaveBeenCalledTimes(3);
      expect(findOwnedActiveGroups).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        'membership-1',
        'root-1',
      );
      expect(findOwnedActiveGroups).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        'membership-2',
        'root-2',
      );
      expect(findOwnedActiveGroups).toHaveBeenNthCalledWith(
        3,
        expect.anything(),
        'membership-3',
        'root-3',
      );
      expect(calls).toEqual(['roleAssignments', 'memberships', 'user', 'clerk']);
    });

    it('deletes every RoleAssignment belonging to all of the Memberships in one call', async () => {
      const deleteUser = jest.fn();
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const memberships = [
        buildMembership({ id: 'membership-1' }),
        buildMembership({ id: 'membership-2' }),
      ];
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue(memberships),
      });

      await service.deleteAccount(buildUser());

      expect(nativeDelete).toHaveBeenCalledWith(RoleAssignment, {
        membership: { $in: ['membership-1', 'membership-2'] },
      });
    });

    it('deletes every Membership belonging to the user', async () => {
      const deleteUser = jest.fn();
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const memberships = [
        buildMembership({ id: 'membership-1' }),
        buildMembership({ id: 'membership-2' }),
      ];
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue(memberships),
      });

      await service.deleteAccount(buildUser());

      expect(nativeDelete).toHaveBeenCalledWith(GroupMembership, {
        id: { $in: ['membership-1', 'membership-2'] },
      });
    });

    it('rejects with CANNOT_DELETE_ACCOUNT_OWNS_GROUPS when the account owns an active Root Group', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const ownedRoot = Object.assign(new Group(), { id: 'root-1' });
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
        findOwnedActiveGroups: jest.fn().mockResolvedValue([ownedRoot]),
      });

      const error: unknown = await service
        .deleteAccount(buildUser())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_DELETE_ACCOUNT_OWNS_GROUPS',
        ownedGroupIds: ['root-1'],
      });
      // Ownership blocks before any deletion or Clerk call is attempted.
      expect(calls).toEqual([]);
    });

    it('rejects with CANNOT_DELETE_ACCOUNT_OWNS_GROUPS when the account owns an active Child Group, not the Root Group itself', async () => {
      const deleteUser = jest.fn();
      const { calls, nativeDelete } = buildTrackedEm(deleteUser);
      const ownedChild = Object.assign(new Group(), { id: 'child-1' });
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
        findOwnedActiveGroups: jest.fn().mockResolvedValue([ownedChild]),
      });

      const error: unknown = await service
        .deleteAccount(buildUser())
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_DELETE_ACCOUNT_OWNS_GROUPS',
        ownedGroupIds: ['child-1'],
      });
      expect(calls).toEqual([]);
    });

    it('rejects and lists every Group when the account owns several Groups at once', async () => {
      const deleteUser = jest.fn();
      const { nativeDelete } = buildTrackedEm(deleteUser);
      const ownedGroups = [
        Object.assign(new Group(), { id: 'child-1' }),
        Object.assign(new Group(), { id: 'child-2' }),
      ];
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
        findOwnedActiveGroups: jest.fn().mockResolvedValue(ownedGroups),
      });

      const error: unknown = await service
        .deleteAccount(buildUser())
        .catch((caught: unknown) => caught);

      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_DELETE_ACCOUNT_OWNS_GROUPS',
        ownedGroupIds: ['child-1', 'child-2'],
      });
    });

    it('never calls Clerk when the ownership check blocks deletion - the check runs first', async () => {
      const deleteUser = jest.fn().mockResolvedValue(undefined);
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const ownedGroup = Object.assign(new Group(), { id: 'root-1' });
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
        findOwnedActiveGroups: jest.fn().mockResolvedValue([ownedGroup]),
      });

      await service.deleteAccount(buildUser()).catch(() => undefined);

      expect(deleteUser).not.toHaveBeenCalled();
      expect(nativeDelete).not.toHaveBeenCalledWith(
        User,
        expect.anything(),
      );
    });

    it('completes without throwing a raw error when nothing is owned - no FK violation surfaces', async () => {
      const deleteUser = jest.fn().mockResolvedValue(undefined);
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const { service } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
      });

      await expect(service.deleteAccount(buildUser())).resolves.toBeUndefined();
    });

    it('runs every local mutation inside a single transaction', async () => {
      const deleteUser = jest.fn().mockResolvedValue(undefined);
      const nativeDelete = jest.fn().mockResolvedValue(0);
      const { service, em } = buildService({
        deleteUser,
        nativeDelete,
        findMemberships: jest.fn().mockResolvedValue([buildMembership()]),
      });

      await service.deleteAccount(buildUser());

      expect(em.transactional).toHaveBeenCalledTimes(1);
    });
  });

  describe('setAvatarPreset', () => {
    it('sets avatarType PRESET, presetAvatarId, and clears avatarUrl', async () => {
      const user = new User();
      user.avatarType = AvatarType.CLERK;
      user.avatarUrl = 'https://img.clerk.com/ada.png';
      const { service, em } = buildService({});

      const updated = await service.setAvatarPreset(user, 'berimbau-01');

      expect(updated.avatarType).toBe(AvatarType.PRESET);
      expect(updated.presetAvatarId).toBe('berimbau-01');
      expect(updated.avatarUrl).toBeNull();
      expect(em.flush).toHaveBeenCalled();
    });

    it('never touches displayName', async () => {
      const user = new User();
      user.displayName = 'Keep Me';
      const { service } = buildService({});

      const updated = await service.setAvatarPreset(user, 'berimbau-01');

      expect(updated.displayName).toBe('Keep Me');
    });
  });

  describe('resetAvatarToClerk', () => {
    it('fetches the current Clerk profile and sets avatarType CLERK with its imageUrl', async () => {
      const user = new User();
      user.clerkUserId = 'user_clerk_1';
      user.avatarType = AvatarType.PRESET;
      user.presetAvatarId = 'berimbau-01';
      user.avatarUrl = null;
      const getUser = jest.fn().mockResolvedValue(buildClerkUser());
      const { service, em } = buildService({ getUser });

      const updated = await service.resetAvatarToClerk(user);

      expect(getUser).toHaveBeenCalledWith('user_clerk_1');
      expect(updated.avatarType).toBe(AvatarType.CLERK);
      expect(updated.avatarUrl).toBe('https://img.clerk.com/ada.png');
      expect(updated.presetAvatarId).toBeNull();
      expect(em.flush).toHaveBeenCalled();
    });

    it('sets avatarUrl to null when Clerk has no imageUrl', async () => {
      const user = new User();
      user.clerkUserId = 'user_clerk_1';
      user.avatarType = AvatarType.UPLOAD;
      user.avatarUrl = 'https://uploads.capohub.app/ada.png';
      const { service } = buildService({
        getUser: jest
          .fn()
          .mockResolvedValue(buildClerkUser({ imageUrl: null })),
      });

      const updated = await service.resetAvatarToClerk(user);

      expect(updated.avatarType).toBe(AvatarType.CLERK);
      expect(updated.avatarUrl).toBeNull();
      expect(updated.presetAvatarId).toBeNull();
    });

    it('never touches displayName', async () => {
      const user = new User();
      user.clerkUserId = 'user_clerk_1';
      user.displayName = 'Keep Me';
      const { service } = buildService({
        getUser: jest.fn().mockResolvedValue(buildClerkUser()),
      });

      const updated = await service.resetAvatarToClerk(user);

      expect(updated.displayName).toBe('Keep Me');
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
