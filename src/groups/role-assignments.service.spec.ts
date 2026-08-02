import { ConflictException, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { MembershipSuspension } from './entities/membership-suspension.entity';
import {
  ROLE_ASSIGNMENTS_UNIQUE_INDEX,
  RoleAssignment,
} from './entities/role-assignment.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { AuditLogService } from './audit-log.service';
import { GroupHierarchyService } from './group-hierarchy.service';
import { RoleAssignmentsService } from './role-assignments.service';

const ACTOR = { id: 'actor-1', displayName: 'Actor' } as never;

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
  membershipSuspensionResults?: (MembershipSuspension | null)[];
  // find (bulk) results - static, not a FIFO queue (no test here needs two
  // different bulk-find results for RoleAssignment within one test).
  roleAssignmentFindResults?: RoleAssignment[];
  membershipFindResults?: GroupMembership[];
  membershipFindAndCountResult?: [GroupMembership[], number];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const roleAssignmentQueue = [...(routing.roleAssignmentResults ?? [])];
  const membershipSuspensionQueue = [
    ...(routing.membershipSuspensionResults ?? []),
  ];

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
    if (entity === MembershipSuspension) {
      return Promise.resolve(membershipSuspensionQueue.shift() ?? null);
    }
    throw new Error(
      `Unexpected findOne entity in test mock: ${String(entity)}`,
    );
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleAssignmentFindResults ?? []);
    }
    if (entity === GroupMembership) {
      return Promise.resolve(routing.membershipFindResults ?? []);
    }
    throw new Error(`Unexpected find entity in test mock: ${String(entity)}`);
  });

  const findAndCount = jest.fn((entity: unknown) => {
    if (entity === GroupMembership) {
      return Promise.resolve(routing.membershipFindAndCountResult ?? [[], 0]);
    }
    throw new Error(
      `Unexpected findAndCount entity in test mock: ${String(entity)}`,
    );
  });

  const raw = {
    findOne,
    find,
    findAndCount,
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
    findAndCount,
  };
}

function buildService(
  em: EntityManager,
  getRootGroupImpl?: (groupId: string, em?: EntityManager) => Promise<Group>,
  getDescendantsImpl?: (groupId: string) => Promise<Group[]>,
) {
  const resolveRootGroup =
    getRootGroupImpl ?? (() => Promise.resolve(buildGroup()));
  const groupHierarchyService = {
    getRootGroup: resolveRootGroup,
    getDescendants: getDescendantsImpl ?? (() => Promise.resolve([])),
    getDescendantSections: () => Promise.resolve([]),
    findCommunityById: (id: string, emArg?: EntityManager) =>
      (emArg ?? em).findOne(Group, { id }),
    resolveRootGroup: (community: Group, emArg?: EntityManager) =>
      resolveRootGroup(community.id, emArg),
  } as unknown as GroupHierarchyService;
  const auditLogService = {
    record: jest.fn().mockResolvedValue(undefined),
  } as unknown as AuditLogService;

  return new RoleAssignmentsService(em, groupHierarchyService, auditLogService);
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
      // resolveAuthorization always delegates root resolution to
      // GroupHierarchyService.resolveRootGroup (see the organizational-
      // domain rebuild, stage 1 - hierarchy logic is centralized there,
      // never duplicated with an inline "already root?" shortcut here).
      // Its own zero-iteration walk correctly returns the Group itself.
      const getRootGroup = jest.fn().mockResolvedValue(rootGroup);
      const service = buildService(em, getRootGroup);

      const result = await service.resolveAuthorization('root-1', 'user-1');

      expect(getRootGroup).toHaveBeenCalledWith('root-1', em);
      expect(result).toEqual({
        community: rootGroup,
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

    it('lazily reconciles an expired suspension back to ACTIVE before resolving Role Assignments', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({
        status: GroupMembershipStatus.READ_ONLY,
      });
      const suspension = new MembershipSuspension();
      suspension.membership = membership;
      suspension.until = new Date('2020-01-01T00:00:00.000Z');
      const roleAssignment = buildRoleAssignment({
        membership,
        group: rootGroup,
      });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        membershipSuspensionResults: [suspension],
        roleAssignmentFindResults: [roleAssignment],
      });
      const service = buildService(em);

      const result = await service.resolveAuthorization('root-1', 'user-1');

      expect(membership.status).toBe(GroupMembershipStatus.ACTIVE);
      expect(suspension.liftedAt).not.toBeNull();
      expect(result?.membership.status).toBe(GroupMembershipStatus.ACTIVE);
    });

    it('leaves an indefinite suspension (until=null) untouched', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({
        status: GroupMembershipStatus.READ_ONLY,
      });
      const suspension = new MembershipSuspension();
      suspension.membership = membership;
      suspension.until = null;
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        membershipSuspensionResults: [suspension],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.resolveAuthorization('root-1', 'user-1');

      expect(membership.status).toBe(GroupMembershipStatus.READ_ONLY);
      expect(suspension.liftedAt).toBeNull();
    });

    it('leaves a suspension that has not yet reached its until date untouched', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({
        status: GroupMembershipStatus.READ_ONLY,
      });
      const suspension = new MembershipSuspension();
      suspension.membership = membership;
      suspension.until = new Date(Date.now() + 60 * 60 * 1000);
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        membershipSuspensionResults: [suspension],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.resolveAuthorization('root-1', 'user-1');

      expect(membership.status).toBe(GroupMembershipStatus.READ_ONLY);
      expect(suspension.liftedAt).toBeNull();
    });

    it('is a no-op when the membership is READ_ONLY but has no active suspension record', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({
        status: GroupMembershipStatus.READ_ONLY,
      });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        membershipSuspensionResults: [null],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.resolveAuthorization('root-1', 'user-1');

      expect(membership.status).toBe(GroupMembershipStatus.READ_ONLY);
    });

    it('never looks up a suspension for an ACTIVE membership', async () => {
      const rootGroup = buildGroup();
      const membership = buildMembership({
        status: GroupMembershipStatus.ACTIVE,
      });
      const { em, findOne } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.resolveAuthorization('root-1', 'user-1');

      expect(findOne).not.toHaveBeenCalledWith(
        MembershipSuspension,
        expect.anything(),
        expect.anything(),
      );
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

  describe('insertRoleAssignment', () => {
    it('unconditionally persists and flushes a new Role Assignment for the given membership/group/role', async () => {
      const { em, persist } = buildMockEm();
      const service = buildService(em);
      const membership = buildMembership();
      const group = buildGroup();

      const result = await service.insertRoleAssignment(
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

  describe('grantRole', () => {
    it('rejects with GROUP_NOT_FOUND when the target group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .grantRole(
          'missing',
          {
            membershipId: 'membership-1',
            role: GroupRole.ADMIN,
          },
          ACTOR,
        )
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
        .grantRole(
          'child-1',
          {
            membershipId: 'missing',
            role: GroupRole.ADMIN,
          },
          ACTOR,
        )
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
        .grantRole(
          'child-1',
          {
            membershipId: 'membership-1',
            role: GroupRole.ADMIN,
          },
          ACTOR,
        )
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
        .grantRole(
          'child-1',
          {
            membershipId: 'membership-1',
            role: GroupRole.ADMIN,
          },
          ACTOR,
        )
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
        .grantRole(
          'child-1',
          {
            membershipId: 'membership-1',
            role: GroupRole.ADMIN,
          },
          ACTOR,
        )
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

      const result = await service.grantRole(
        'child-1',
        {
          membershipId: 'membership-1',
          role: GroupRole.ADMIN,
        },
        ACTOR,
      );

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

      await service.grantRole(
        'root-1',
        {
          membershipId: 'membership-1',
          role: GroupRole.MEMBER,
        },
        ACTOR,
      );

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
        .grantRole(
          'root-1',
          {
            membershipId: 'membership-1',
            role: GroupRole.MEMBER,
          },
          ACTOR,
        )
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

  describe('revokeRole', () => {
    it('removes a non-owner, non-member assignment', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.ADMIN });
      const { em, remove } = buildMockEm({
        roleAssignmentResults: [assignment],
      });
      const service = buildService(em);

      await service.revokeRole('root-1', 'role-assignment-1', ACTOR);

      expect(remove).toHaveBeenCalledWith(assignment);
    });

    it('rejects with CANNOT_REMOVE_OWNER for an OWNER assignment', async () => {
      const assignment = buildRoleAssignment({ role: GroupRole.OWNER });
      const { em } = buildMockEm({ roleAssignmentResults: [assignment] });
      const service = buildService(em);

      const error: unknown = await service
        .revokeRole('root-1', 'role-assignment-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_OWNER',
      });
    });

    it("rejects with CANNOT_REMOVE_ROOT_MEMBER_ROLE when revoking MEMBER for the membership's own Root Group", async () => {
      // buildMembership()'s rootGroup and buildRoleAssignment()'s group
      // both default to id 'root-1' - this is exactly the Root Group case.
      const assignment = buildRoleAssignment({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({ roleAssignmentResults: [assignment] });
      const service = buildService(em);

      const error: unknown = await service
        .revokeRole('root-1', 'role-assignment-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_ROOT_MEMBER_ROLE',
      });
    });

    it('rejects with CANNOT_REMOVE_MEMBER_ROLE when revoking MEMBER for a Child Group while another Role is still held there', async () => {
      const membership = buildMembership({
        rootGroup: buildGroup({ id: 'root-1' }),
      });
      const assignment = buildRoleAssignment({
        role: GroupRole.MEMBER,
        membership,
        group: buildGroup({ id: 'child-1' }),
      });
      const { em } = buildMockEm({
        roleAssignmentResults: [assignment],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.INSTRUCTOR }),
        ],
      });
      const service = buildService(em);

      const error: unknown = await service
        .revokeRole('child-1', 'role-assignment-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_MEMBER_ROLE',
      });
    });

    it('allows revoking MEMBER for a Child Group when it is the only Role held there - this removes the user from the Child Group', async () => {
      const membership = buildMembership({
        rootGroup: buildGroup({ id: 'root-1' }),
      });
      const assignment = buildRoleAssignment({
        role: GroupRole.MEMBER,
        membership,
        group: buildGroup({ id: 'child-1' }),
      });
      const { em, remove } = buildMockEm({
        roleAssignmentResults: [assignment],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.revokeRole('child-1', 'role-assignment-1', ACTOR);

      expect(remove).toHaveBeenCalledWith(assignment);
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

  describe('findOwnedActiveGroups', () => {
    it('returns empty when the Membership holds no OWNER Role Assignment anywhere in the tree', async () => {
      const { em } = buildMockEm({ roleAssignmentFindResults: [] });
      const service = buildService(em);

      const result = await service.findOwnedActiveGroups(
        em,
        'membership-1',
        'root-1',
      );

      expect(result).toEqual([]);
    });

    it('includes the Root Group itself when the Membership owns it', async () => {
      const rootGroup = buildGroup();
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: rootGroup }),
        ],
      });
      const service = buildService(em);

      const result = await service.findOwnedActiveGroups(
        em,
        'membership-1',
        'root-1',
      );

      expect(result).toEqual([rootGroup]);
    });

    it('includes a Child Group, at any depth, when the Membership owns it - not just the Root Group', async () => {
      const rootGroup = buildGroup();
      const childGroup = buildGroup({ id: 'child-1', parentGroup: rootGroup });
      const grandchildGroup = buildGroup({
        id: 'grandchild-1',
        parentGroup: childGroup,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({
            role: GroupRole.OWNER,
            group: grandchildGroup,
          }),
        ],
      });
      const service = buildService(em, undefined, () =>
        Promise.resolve([childGroup, grandchildGroup]),
      );

      const result = await service.findOwnedActiveGroups(
        em,
        'membership-1',
        'root-1',
      );

      expect(result).toEqual([grandchildGroup]);
    });

    it('excludes an archived Group even if the Membership still holds OWNER there', async () => {
      const archivedChild = buildGroup({
        id: 'child-archived',
        parentGroup: buildGroup(),
        status: GroupStatus.ARCHIVED,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: archivedChild }),
        ],
      });
      const service = buildService(em, undefined, () =>
        Promise.resolve([archivedChild]),
      );

      const result = await service.findOwnedActiveGroups(
        em,
        'membership-1',
        'root-1',
      );

      expect(result).toEqual([]);
    });

    it('includes a READ_ONLY Group - it is not archived, so it must not be left ownerless either', async () => {
      const readOnlyChild = buildGroup({
        id: 'child-read-only',
        parentGroup: buildGroup(),
        status: GroupStatus.READ_ONLY,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: readOnlyChild }),
        ],
      });
      const service = buildService(em, undefined, () =>
        Promise.resolve([readOnlyChild]),
      );

      const result = await service.findOwnedActiveGroups(
        em,
        'membership-1',
        'root-1',
      );

      expect(result).toEqual([readOnlyChild]);
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

  describe('getGroupParticipationForMemberships', () => {
    it('discovers every Group a Membership holds a Role in, including Child Groups never asked about explicitly', async () => {
      const membershipOne = buildMembership({ id: 'membership-1' });
      const rootMember = buildRoleAssignment({
        membership: membershipOne,
        group: buildGroup({ id: 'root-1' }),
        role: GroupRole.MEMBER,
      });
      const childMember = buildRoleAssignment({
        membership: membershipOne,
        group: buildGroup({ id: 'child-1' }),
        role: GroupRole.MEMBER,
      });
      const childInstructor = buildRoleAssignment({
        membership: membershipOne,
        group: buildGroup({ id: 'child-1' }),
        role: GroupRole.INSTRUCTOR,
      });
      const { em } = buildMockEm({
        roleAssignmentFindResults: [rootMember, childMember, childInstructor],
      });
      const service = buildService(em);

      const result = await service.getGroupParticipationForMemberships([
        'membership-1',
      ]);

      expect(result).toEqual(
        expect.arrayContaining([
          {
            membershipId: 'membership-1',
            groupId: 'root-1',
            roles: [GroupRole.MEMBER],
          },
          {
            membershipId: 'membership-1',
            groupId: 'child-1',
            roles: [GroupRole.MEMBER, GroupRole.INSTRUCTOR],
          },
        ]),
      );
      expect(result).toHaveLength(2);
    });

    it('returns an empty array without querying when given no membership ids', async () => {
      const { em, find } = buildMockEm({ roleAssignmentFindResults: [] });
      const service = buildService(em);

      const result = await service.getGroupParticipationForMemberships([]);

      expect(result).toEqual([]);
      expect(find).not.toHaveBeenCalled();
    });
  });

  describe('isCommunityMember', () => {
    it('returns false when the community does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      expect(await service.isCommunityMember('missing', 'user-1')).toBe(false);
    });

    it('for a Root Group, a plain active Membership is enough - no Role required', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const membership = buildMembership({ rootGroup });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [membership],
      });
      const service = buildService(em);

      expect(await service.isCommunityMember('root-1', 'user-1')).toBe(true);
    });

    it('for a Root Group, returns false when there is no active/read-only Membership', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipResults: [null],
      });
      const service = buildService(em);

      expect(await service.isCommunityMember('root-1', 'user-1')).toBe(false);
    });

    it('for a Section, requires an actual Role Assignment for that exact Section - plain Membership alone is not enough', async () => {
      const section = buildGroup({
        id: 'section-1',
        parentGroup: 'root-1' as never,
      });
      const membership = buildMembership();
      const { em } = buildMockEm({
        // First findOne(Group) is isCommunityMember's own lookup; the
        // second is resolveAuthorization's own independent lookup.
        groupResults: [section, section],
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      expect(await service.isCommunityMember('section-1', 'user-1')).toBe(
        false,
      );
    });

    it('for a Section, returns true when the user holds any Role Assignment there', async () => {
      const section = buildGroup({
        id: 'section-1',
        parentGroup: 'root-1' as never,
      });
      const membership = buildMembership();
      const roleAssignment = buildRoleAssignment({
        membership,
        group: section,
      });
      const { em } = buildMockEm({
        groupResults: [section, section],
        membershipResults: [membership],
        roleAssignmentFindResults: [roleAssignment],
      });
      const service = buildService(em);

      expect(await service.isCommunityMember('section-1', 'user-1')).toBe(true);
    });
  });

  describe('findEligibleMemberIds', () => {
    it('returns an empty set immediately when given no userIds, without querying', async () => {
      const { em, findOne, find } = buildMockEm();
      const service = buildService(em);

      const result = await service.findEligibleMemberIds('root-1', []);

      expect(result.size).toBe(0);
      expect(findOne).not.toHaveBeenCalled();
      expect(find).not.toHaveBeenCalled();
    });

    it('returns an empty set when the community does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      const result = await service.findEligibleMemberIds('missing', ['user-1']);

      expect(result.size).toBe(0);
    });

    it('for a Root Group, returns exactly the user ids the bulk Membership lookup resolves', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const membershipA = buildMembership({
        user: { id: 'user-1', displayName: 'A' } as never,
      });
      const membershipB = buildMembership({
        user: { id: 'user-2', displayName: 'B' } as never,
      });
      const { em } = buildMockEm({
        groupResults: [rootGroup],
        membershipFindResults: [membershipA, membershipB],
      });
      const service = buildService(em);

      const result = await service.findEligibleMemberIds('root-1', [
        'user-1',
        'user-2',
        'user-3',
      ]);

      expect(result).toEqual(new Set(['user-1', 'user-2']));
    });

    it('for a Section, only counts users with a Role Assignment for that exact Section', async () => {
      const section = buildGroup({
        id: 'section-1',
        parentGroup: 'root-1' as never,
      });
      const membership = buildMembership({
        user: { id: 'user-1', displayName: 'A' } as never,
      });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: section,
      });
      const { em } = buildMockEm({
        groupResults: [section],
        roleAssignmentFindResults: [roleAssignment],
        membershipFindResults: [membership],
      });
      const service = buildService(em);

      const result = await service.findEligibleMemberIds('section-1', [
        'user-1',
      ]);

      expect(result).toEqual(new Set(['user-1']));
    });
  });

  describe('findEligibleMembers', () => {
    it('returns an empty page when the community does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      const result = await service.findEligibleMembers('missing', {
        limit: 50,
        offset: 0,
      });

      expect(result).toEqual({ items: [], total: 0 });
    });

    it('for a Root Group, returns items/total exactly as the paginated Membership query resolves', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const memberA = { id: 'user-1', displayName: 'Ana' } as never;
      const memberB = { id: 'user-2', displayName: 'Beto' } as never;
      const membershipA = buildMembership({ user: memberA });
      const membershipB = buildMembership({ user: memberB });
      const { em, findAndCount } = buildMockEm({
        groupResults: [rootGroup],
        membershipFindAndCountResult: [[membershipA, membershipB], 2],
      });
      const service = buildService(em);

      const result = await service.findEligibleMembers('root-1', {
        limit: 50,
        offset: 0,
      });

      expect(result).toEqual({ items: [memberA, memberB], total: 2 });
      expect(findAndCount).toHaveBeenCalledTimes(1);
    });

    it('passes limit/offset straight through to the paginated query', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const { em, findAndCount } = buildMockEm({
        groupResults: [rootGroup],
        membershipFindAndCountResult: [[], 0],
      });
      const service = buildService(em);

      await service.findEligibleMembers('root-1', { limit: 10, offset: 20 });

      expect(findAndCount).toHaveBeenCalledWith(
        GroupMembership,
        expect.anything(),
        expect.objectContaining({ limit: 10, offset: 20 }),
      );
    });

    it('for a Section, resolves eligible members from the Role Assignment id set, not every Root Group member', async () => {
      const section = buildGroup({
        id: 'section-1',
        parentGroup: 'root-1' as never,
      });
      const member = { id: 'user-1', displayName: 'Ana' } as never;
      const membership = buildMembership({ user: member });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: section,
      });
      const { em, findAndCount } = buildMockEm({
        groupResults: [section],
        roleAssignmentFindResults: [roleAssignment],
        membershipFindAndCountResult: [[membership], 1],
      });
      const service = buildService(em);

      const result = await service.findEligibleMembers('section-1', {
        limit: 50,
        offset: 0,
      });

      expect(result).toEqual({ items: [member], total: 1 });
      expect(findAndCount).toHaveBeenCalledTimes(1);
    });
  });

  describe('getCommunityIdsWithAnyRole', () => {
    it('returns an empty array when the user has no memberships at all', async () => {
      const { em } = buildMockEm({ membershipFindResults: [] });
      const service = buildService(em);

      expect(await service.getCommunityIdsWithAnyRole('user-1')).toEqual([]);
    });

    it('returns every distinct Group/Section id the user holds any Role Assignment for, across every Membership', async () => {
      const membership = buildMembership({ id: 'membership-1' });
      const { em } = buildMockEm({
        membershipFindResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({
            membership,
            group: buildGroup({ id: 'root-1' }),
          }),
          buildRoleAssignment({
            membership,
            group: buildGroup({ id: 'child-1' }),
          }),
        ],
      });
      const service = buildService(em);

      const result = await service.getCommunityIdsWithAnyRole('user-1');

      expect([...result].sort()).toEqual(['child-1', 'root-1']);
    });
  });
});
