import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import {
  ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  RoleAssignment,
} from './entities/role-assignment.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { RoleAssignmentsService } from './role-assignments.service';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'root-1';
  group.name = 'Capoeira Angola SP';
  group.status = GroupStatus.ACTIVE;
  group.parentGroup = null;
  return Object.assign(group, overrides);
}

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.status = GroupMembershipStatus.ACTIVE;
  membership.rootGroup = buildGroup();
  membership.user = { id: 'user-1', displayName: 'Member' } as never;
  return Object.assign(membership, overrides);
}

function buildRoleAssignment(
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  const assignment = new RoleAssignment();
  assignment.id = 'role-assignment-1';
  assignment.role = GroupRole.MEMBER;
  assignment.membership = buildMembership();
  assignment.group = buildGroup();
  assignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(assignment, overrides);
}

interface MockRouting {
  groupResults?: (Group | null)[];
  membershipResults?: (GroupMembership | null)[];
  // findOne results, FIFO.
  roleAssignmentResults?: (RoleAssignment | null)[];
  // find (bulk) results - static, not a FIFO queue (no test here needs two
  // different bulk-find results for RoleAssignment within one test).
  roleAssignmentFindResults?: RoleAssignment[];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const roleAssignmentQueue = [...(routing.roleAssignmentResults ?? [])];

  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown) => {
    if (entity === Group) {
      return Promise.resolve(groupQueue.shift() ?? null);
    }
    if (entity === GroupMembership) {
      return Promise.resolve(membershipQueue.shift() ?? null);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(roleAssignmentQueue.shift() ?? null);
    }
    throw new Error(
      `Unexpected findOne entity in test mock: ${String(entity)}`,
    );
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleAssignmentFindResults ?? []);
    }
    throw new Error(`Unexpected find entity in test mock: ${String(entity)}`);
  });

  const raw = {
    findOne,
    find,
    persist,
    remove,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return {
    em: raw as unknown as EntityManager,
    persist,
    remove,
    findOne,
    find,
  };
}

function buildService(
  em: EntityManager,
  getRootGroupImpl?: (groupId: string) => Promise<Group>,
) {
  const groupHierarchyService = {
    getRootGroup: getRootGroupImpl ?? (() => Promise.resolve(buildGroup())),
  } as unknown as GroupHierarchyService;

  return new RoleAssignmentsService(em, groupHierarchyService);
}

describe('RoleAssignmentsService', () => {
  describe('resolveAuthorization', () => {
    it('returns null when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      expect(
        await service.resolveAuthorization('missing', 'user-1'),
      ).toBeNull();
    });

    it('resolves the Root Group directly when the acted-on group is itself a Root Group', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership();
      const roleAssignment = buildRoleAssignment({
        membership,
        group: rootGroup,
      });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [roleAssignment],
      });
      const getRootGroup = jest.fn();
      const service = buildService(em, getRootGroup);

      const result = await service.resolveAuthorization('root-1', 'user-1');

      expect(getRootGroup).not.toHaveBeenCalled();
      expect(result).toEqual({
        group: rootGroup,
        membership,
        roleAssignments: [roleAssignment],
      });
    });

    it('resolves through the Root Group when the acted-on group is a Child Group', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const rootGroup = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ rootGroup });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: childGroup,
      });
      const getRootGroup = jest.fn().mockResolvedValue(rootGroup);
      const { em } = buildMockEm({
        groupResults: [childGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [roleAssignment],
      });
      const service = buildService(em, getRootGroup);

      const result = await service.resolveAuthorization('child-1', 'user-1');

      expect(getRootGroup).toHaveBeenCalledWith('child-1', em);
      expect(result?.roleAssignments).toEqual([roleAssignment]);
    });

    it('returns every Role Assignment held for the Group when the membership holds more than one', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership();
      const memberRole = buildRoleAssignment({
        membership,
        group: rootGroup,
        role: GroupRole.MEMBER,
      });
      const adminRole = buildRoleAssignment({
        membership,
        group: rootGroup,
        role: GroupRole.ADMIN,
      });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [memberRole, adminRole],
      });
      const service = buildService(em);

      const result = await service.resolveAuthorization('root-1', 'user-1');

      expect(result?.roleAssignments).toEqual([memberRole, adminRole]);
    });

    it('returns null when the caller has no usable Membership in the Root Group', async () => {
      const rootGroup = buildGroup();
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [null],
      });
      const service = buildService(em);

      expect(await service.resolveAuthorization('root-1', 'user-1')).toBeNull();
    });

    it('returns null when the Membership has no Role Assignment for this exact Group - never a fallback to the Root Group', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership();
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      expect(await service.resolveAuthorization('root-1', 'user-1')).toBeNull();
    });
  });

  describe('ensureMemberRole', () => {
    it('creates a MEMBER Role Assignment when none exists yet', async () => {
      const { em, persist } = buildMockEm({ roleAssignmentResults: [null] });
      const service = buildService(em);
      const membership = buildMembership();
      const group = buildGroup();

      await service.ensureMemberRole(em, membership, group);

      expect(persist).toHaveBeenCalledTimes(1);
      const persisted = persist.mock.calls[0][0] as RoleAssignment;
      expect(persisted.role).toBe(GroupRole.MEMBER);
      expect(persisted.membership).toBe(membership);
      expect(persisted.group).toBe(group);
    });

    it('is a no-op when a MEMBER Role Assignment already exists', async () => {
      const existing = buildRoleAssignment({ role: GroupRole.MEMBER });
      const { em, persist } = buildMockEm({
        roleAssignmentResults: [existing],
      });
      const service = buildService(em);

      await service.ensureMemberRole(em, buildMembership(), buildGroup());

      expect(persist).not.toHaveBeenCalled();
    });
  });

  describe('grantRole', () => {
    it('unconditionally persists and flushes a new Role Assignment for the given membership/group/role', async () => {
      const { em, persist } = buildMockEm();
      const service = buildService(em);
      const membership = buildMembership();
      const group = buildGroup();

      const result = await service.grantRole(
        em,
        membership,
        group,
        GroupRole.OWNER,
      );

      expect(result.membership).toBe(membership);
      expect(result.group).toBe(group);
      expect(result.role).toBe(GroupRole.OWNER);
      expect(persist).toHaveBeenCalledWith(result);
    });
  });

  describe('assignRole', () => {
    it('rejects with GROUP_NOT_FOUND when the target group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .assignRole('missing', {
          membershipId: 'membership-1',
          role: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'GROUP_NOT_FOUND',
      });
    });

    it('rejects with MEMBERSHIP_NOT_FOUND when the membership does not exist', async () => {
      const { em } = buildMockEm({
        groupResults: [buildGroup({ id: 'child-1' })],
        membershipResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignRole('child-1', {
          membershipId: 'missing',
          role: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_FOUND',
      });
    });

    it('rejects with ROLE_ROOT_GROUP_MISMATCH when the membership belongs to a different Root Group', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const membership = buildMembership({
        rootGroup: buildGroup({ id: 'other-root' }),
      });
      const getRootGroup = jest
        .fn()
        .mockResolvedValue(buildGroup({ id: 'root-1' }));
      const { em } = buildMockEm({
        groupResults: [childGroup],
        membershipResults: [membership],
      });
      const service = buildService(em, getRootGroup);

      const error: unknown = await service
        .assignRole('child-1', {
          membershipId: 'membership-1',
          role: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ROLE_ROOT_GROUP_MISMATCH',
      });
    });

    it('rejects with ROLE_MEMBERSHIP_NOT_ACTIVE when the membership is not ACTIVE', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const rootGroup = buildGroup({ id: 'root-1' });
      const membership = buildMembership({
        rootGroup,
        status: GroupMembershipStatus.READ_ONLY,
      });
      const getRootGroup = jest.fn().mockResolvedValue(rootGroup);
      const { em } = buildMockEm({
        groupResults: [childGroup],
        membershipResults: [membership],
      });
      const service = buildService(em, getRootGroup);

      const error: unknown = await service
        .assignRole('child-1', {
          membershipId: 'membership-1',
          role: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ROLE_MEMBERSHIP_NOT_ACTIVE',
      });
    });

    it('rejects with ROLE_ASSIGNMENT_ALREADY_EXISTS when the membership already holds this exact Role for this Group', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const rootGroup = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ rootGroup });
      const getRootGroup = jest.fn().mockResolvedValue(rootGroup);
      const { em } = buildMockEm({
        groupResults: [childGroup],
        membershipResults: [membership],
        roleAssignmentResults: [buildRoleAssignment({ role: GroupRole.ADMIN })],
      });
      const service = buildService(em, getRootGroup);

      const error: unknown = await service
        .assignRole('child-1', {
          membershipId: 'membership-1',
          role: GroupRole.ADMIN,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
      });
    });

    it('grants a second, different Role to a membership that already holds one Role for this Group (multi-role)', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const rootGroup = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ rootGroup });
      const getRootGroup = jest.fn().mockResolvedValue(rootGroup);
      const { em, persist } = buildMockEm({
        groupResults: [childGroup],
        membershipResults: [membership],
        // No existing ADMIN row for this (membership, group, role) - the
        // membership may already hold e.g. MEMBER or INSTRUCTOR there,
        // which is irrelevant to this check.
        roleAssignmentResults: [null],
      });
      const service = buildService(em, getRootGroup);

      const result = await service.assignRole('child-1', {
        membershipId: 'membership-1',
        role: GroupRole.ADMIN,
      });

      expect(result.role).toBe(GroupRole.ADMIN);
      // ADMIN !== MEMBER, so ensureMemberRole runs first (its own findOne
      // check consumed the only queued result above as "not found", so it
      // also persists a MEMBER row) - two persists total.
      expect(persist).toHaveBeenCalledTimes(2);
      const persistedMember = persist.mock.calls[0][0] as RoleAssignment;
      const persistedAdmin = persist.mock.calls[1][0] as RoleAssignment;
      expect(persistedMember.role).toBe(GroupRole.MEMBER);
      expect(persistedAdmin.role).toBe(GroupRole.ADMIN);
    });

    it('grants MEMBER directly without a redundant ensureMemberRole call when the requested Role is itself MEMBER', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({ rootGroup });
      const { em, persist } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        roleAssignmentResults: [null],
      });
      const service = buildService(em);

      await service.assignRole('root-1', {
        membershipId: 'membership-1',
        role: GroupRole.MEMBER,
      });

      expect(persist).toHaveBeenCalledTimes(1);
    });

    it('maps a database-level unique-violation race to ROLE_ASSIGNMENT_ALREADY_EXISTS', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({ rootGroup });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        roleAssignmentResults: [null],
        flushError: new UniqueConstraintViolationException(
          new Error(
            `duplicate key value violates unique constraint "${ROLE_ASSIGNMENTS_UNIQUE_INDEX}"`,
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignRole('root-1', {
          membershipId: 'membership-1',
          role: GroupRole.MEMBER,
        })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
      });
    });
  });

  describe('getRoleAssignment', () => {
    it('throws ROLE_ASSIGNMENT_NOT_FOUND when no assignment matches', async () => {
      const { em } = buildMockEm({ roleAssignmentResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .getRoleAssignment('root-1', 'missing')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'ROLE_ASSIGNMENT_NOT_FOUND',
      });
    });
  });

  describe('changeRole', () => {
    it('updates the role of a non-owner assignment', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({
        roleAssignmentResults: [assignment, null],
      });
      const service = buildService(em);

      await service.changeRole('root-1', 'role-assignment-1', {
        role: GroupRole.ADMIN,
      });

      expect(assignment.role).toBe(GroupRole.ADMIN);
    });

    it('rejects with ROLE_ASSIGNMENT_ALREADY_EXISTS when the membership already holds the target role in another row', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.MEMBER });
      const conflicting = buildRoleAssignment({ role: GroupRole.ADMIN });
      const { em } = buildMockEm({
        roleAssignmentResults: [assignment, conflicting],
      });
      const service = buildService(em);

      const error: unknown = await service
        .changeRole('root-1', 'role-assignment-1', { role: GroupRole.ADMIN })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ROLE_ASSIGNMENT_ALREADY_EXISTS',
      });
    });

    it('rejects with CANNOT_CHANGE_OWNER_ROLE for an OWNER assignment', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ roleAssignmentResults: [assignment] });
      const service = buildService(em);

      const error: unknown = await service
        .changeRole('root-1', 'role-assignment-1', { role: GroupRole.ADMIN })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_CHANGE_OWNER_ROLE',
      });
    });
  });

  describe('revokeRole', () => {
    it('removes a non-owner assignment', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.ADMIN });
      const { em, remove } = buildMockEm({
        roleAssignmentResults: [assignment],
      });
      const service = buildService(em);

      await service.revokeRole('root-1', 'role-assignment-1');

      expect(remove).toHaveBeenCalledWith(assignment);
    });

    it('rejects with CANNOT_REMOVE_OWNER for an OWNER assignment', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ roleAssignmentResults: [assignment] });
      const service = buildService(em);

      const error: unknown = await service
        .revokeRole('root-1', 'role-assignment-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_OWNER',
      });
    });
  });

  describe('hasRole', () => {
    it('returns true when a Role Assignment exists for the exact role', async () => {
      const { em } = buildMockEm({
        roleAssignmentResults: [buildRoleAssignment({ role: GroupRole.OWNER })],
      });
      const service = buildService(em);

      expect(
        await service.hasRole(em, 'membership-1', 'root-1', GroupRole.OWNER),
      ).toBe(true);
    });

    it('returns false when no Role Assignment exists for the exact role - even if others exist', async () => {
      const { em } = buildMockEm({ roleAssignmentResults: [null] });
      const service = buildService(em);

      expect(
        await service.hasRole(em, 'membership-1', 'root-1', GroupRole.OWNER),
      ).toBe(false);
    });
  });

  describe('findRoleAssignment', () => {
    it('returns the specific (membership, group, role) row when it exists', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ roleAssignmentResults: [assignment] });
      const service = buildService(em);

      const result = await service.findRoleAssignment(
        em,
        'membership-1',
        'root-1',
        GroupRole.OWNER,
      );

      expect(result).toBe(assignment);
    });
  });

  describe('getRoleAssignmentsForMembership', () => {
    it('returns every Role Assignment a membership holds for a specific Group', async () => {
      const memberRole = buildRoleAssignment({ role: GroupRole.MEMBER });
      const adminRole = buildRoleAssignment({ role: GroupRole.ADMIN });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [memberRole, adminRole],
      });
      const service = buildService(em);

      const result = await service.getRoleAssignmentsForMembership(
        em,
        'membership-1',
        'root-1',
      );

      expect(result).toEqual([memberRole, adminRole]);
    });
  });

  describe('getRoleAssignmentsForGroup', () => {
    it('groups multiple Roles under the same membership id', async () => {
      const membershipOne = buildMembership({ id: 'membership-1' });
      const memberRole = buildRoleAssignment({
        membership: membershipOne,
        role: GroupRole.MEMBER,
      });
      const adminRole = buildRoleAssignment({
        membership: membershipOne,
        role: GroupRole.ADMIN,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [memberRole, adminRole],
      });
      const service = buildService(em);

      const result = await service.getRoleAssignmentsForGroup(
        ['membership-1'],
        'root-1',
      );

      expect(result.get('membership-1')).toEqual([
        GroupRole.MEMBER,
        GroupRole.ADMIN,
      ]);
    });
  });

  describe('getRoleAssignmentsForMemberships', () => {
    it('matches each (membershipId, groupId) pair to every Role held there, across different Root Groups', async () => {
      const membershipOne = buildMembership({ id: 'membership-1' });
      const assignmentOneMember = buildRoleAssignment({
        membership: membershipOne,
        group: buildGroup({ id: 'root-1' }),
        role: GroupRole.MEMBER,
      });
      const assignmentOneOwner = buildRoleAssignment({
        membership: membershipOne,
        group: buildGroup({ id: 'root-1' }),
        role: GroupRole.OWNER,
      });
      const assignmentTwo = buildRoleAssignment({
        membership: buildMembership({ id: 'membership-2' }),
        group: buildGroup({ id: 'root-2' }),
        role: GroupRole.MEMBER,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          assignmentOneMember,
          assignmentOneOwner,
          assignmentTwo,
        ],
      });
      const service = buildService(em);

      const result = await service.getRoleAssignmentsForMemberships([
        { membershipId: 'membership-1', groupId: 'root-1' },
        { membershipId: 'membership-2', groupId: 'root-2' },
      ]);

      expect(result.get('membership-1')).toEqual([
        GroupRole.MEMBER,
        GroupRole.OWNER,
      ]);
      expect(result.get('membership-2')).toEqual([GroupRole.MEMBER]);
    });

    it('omits a pair when no Role Assignment matches that exact (membership, group)', async () => {
      const { em } = buildMockEm({ roleAssignmentFindResults: [] });
      const service = buildService(em);

      const result = await service.getRoleAssignmentsForMemberships([
        { membershipId: 'membership-1', groupId: 'root-1' },
      ]);

      expect(result.has('membership-1')).toBe(false);
    });
  });
});
