import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX,
  GroupMembership,
} from './entities/group-membership.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupMembershipsService } from './group-memberships.service';

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.role = GroupRole.MEMBER;
  membership.status = GroupMembershipStatus.ACTIVE;
  membership.user = { id: 'user-1', displayName: 'Member' } as never;
  return Object.assign(membership, overrides);
}

interface MockRouting {
  findOneResults?: unknown[];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });
  const results = [...(routing.findOneResults ?? [])];
  const findOne = jest.fn().mockImplementation(() => {
    return Promise.resolve(results.length > 0 ? results.shift() : null);
  });
  const getReference = jest
    .fn()
    .mockImplementation((_entity: unknown, id: string) => ({ id }));

  const raw = {
    findOne,
    persist,
    getReference,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, findOne };
}

describe('GroupMembershipsService', () => {
  describe('addMember', () => {
    it('creates a new active membership for an existing user', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({ findOneResults: [user, null] });
      const service = new GroupMembershipsService(em);

      await service.addMember('group-1', {
        userId: 'user-2',
        role: GroupRole.MEMBER,
      });

      const persisted = persist.mock.calls[0][0] as GroupMembership;
      expect(persisted.role).toBe(GroupRole.MEMBER);
      expect(persisted.user).toBe(user);
    });

    it('rejects with USER_NOT_FOUND when the target user does not exist', async () => {
      const { em } = buildMockEm({ findOneResults: [null] });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .addMember('group-1', { userId: 'missing', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('rejects with ALREADY_A_MEMBER when the user already has an active membership', async () => {
      const user = new User();
      user.id = 'user-2';
      const existingMembership = buildMembership();
      const { em } = buildMockEm({
        findOneResults: [user, existingMembership],
      });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .addMember('group-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_A_MEMBER',
      });
    });

    it('maps a database-level unique-violation race to ALREADY_A_MEMBER instead of a raw DB error', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em } = buildMockEm({
        findOneResults: [user, null],
        flushError: new UniqueConstraintViolationException(
          new Error(
            `duplicate key value violates unique constraint "${GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX}"`,
          ),
        ),
      });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .addMember('group-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_A_MEMBER',
      });
    });
  });

  describe('changeRole', () => {
    it('updates the role of a non-owner membership', async () => {
      const membership = buildMembership({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({ findOneResults: [membership] });
      const service = new GroupMembershipsService(em);

      await service.changeRole('group-1', 'membership-1', {
        role: GroupRole.ADMIN,
      });

      expect(membership.role).toBe(GroupRole.ADMIN);
    });

    it('rejects with CANNOT_CHANGE_OWNER_ROLE when the target is the owner', async () => {
      const membership = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ findOneResults: [membership] });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .changeRole('group-1', 'membership-1', { role: GroupRole.ADMIN })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_CHANGE_OWNER_ROLE',
      });
    });

    it('throws NotFoundException when the membership does not exist', async () => {
      const { em } = buildMockEm({ findOneResults: [null] });
      const service = new GroupMembershipsService(em);

      await expect(
        service.changeRole('group-1', 'missing', { role: GroupRole.ADMIN }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('removeMember', () => {
    it('marks a non-owner membership as REMOVED', async () => {
      const membership = buildMembership({ role: GroupRole.ADMIN });
      const { em } = buildMockEm({ findOneResults: [membership] });
      const service = new GroupMembershipsService(em);

      await service.removeMember('group-1', 'membership-1');

      expect(membership.status).toBe(GroupMembershipStatus.REMOVED);
      expect(membership.leftAt).not.toBeNull();
    });

    it('rejects with CANNOT_REMOVE_OWNER when the target is the owner', async () => {
      const membership = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ findOneResults: [membership] });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .removeMember('group-1', 'membership-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_OWNER',
      });
    });
  });

  describe('leave', () => {
    it('marks the membership as LEFT for a non-owner', async () => {
      const membership = buildMembership({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({ findOneResults: [membership] });
      const service = new GroupMembershipsService(em);

      await service.leave('group-1', 'user-1');

      expect(membership.status).toBe(GroupMembershipStatus.LEFT);
      expect(membership.leftAt).not.toBeNull();
    });

    it('rejects with OWNER_MUST_TRANSFER_OWNERSHIP when the caller is the owner', async () => {
      const membership = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ findOneResults: [membership] });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .leave('group-1', 'user-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
      });
    });
  });

  describe('transferOwnership', () => {
    it('rejects transferring to self', async () => {
      const { em } = buildMockEm();
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .transferOwnership('group-1', 'user-1', {
          newOwnerUserId: 'user-1',
          previousOwnerRole: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'CANNOT_TRANSFER_TO_SELF',
      });
    });

    it('rejects with TARGET_NOT_A_MEMBER when the new owner has no active membership', async () => {
      const previousOwner = buildMembership({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ findOneResults: [previousOwner, null] });
      const service = new GroupMembershipsService(em);

      const error: unknown = await service
        .transferOwnership('group-1', 'user-1', {
          newOwnerUserId: 'user-2',
          previousOwnerRole: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'TARGET_NOT_A_MEMBER',
      });
    });

    it('sets the previous owner to previousOwnerRole and the target to OWNER', async () => {
      const previousOwner = buildMembership({
        id: 'membership-owner',
        role: GroupRole.OWNER,
      });
      const newOwner = buildMembership({
        id: 'membership-target',
        role: GroupRole.MEMBER,
      });
      const { em } = buildMockEm({
        findOneResults: [previousOwner, newOwner],
      });
      const service = new GroupMembershipsService(em);

      await service.transferOwnership('group-1', 'user-1', {
        newOwnerUserId: 'user-2',
        previousOwnerRole: GroupRole.ADMIN,
      });

      expect(previousOwner.role).toBe(GroupRole.ADMIN);
      expect(newOwner.role).toBe(GroupRole.OWNER);
    });
  });
});
