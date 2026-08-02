import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import {
  GROUP_BANS_ACTIVE_UNIQUE_INDEX,
  GroupBan,
} from './entities/group-ban.entity';
import { GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX } from './entities/group-membership.entity';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import {
  MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX,
  MembershipSuspension,
} from './entities/membership-suspension.entity';
import { MembershipCohort } from './entities/membership-cohort.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { Cohort } from './entities/cohort.entity';
import { AuditAction } from './enums/audit-action.enum';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { MembershipEndReason } from './enums/membership-end-reason.enum';
import { CohortStatus } from './enums/cohort-status.enum';
import { AuditLogService } from './audit-log.service';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupMembershipsService } from './group-memberships.service';
import { RoleAssignmentsService } from './role-assignments.service';

const ACTOR = { id: 'user-1', displayName: 'Actor' } as unknown as User;

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

function buildCohort(overrides: Partial<Cohort> = {}): Cohort {
  const cohort = new Cohort();
  cohort.id = 'cohort-1';
  cohort.name = 'Kids';
  cohort.status = CohortStatus.ACTIVE;
  cohort.group = buildGroup();
  return Object.assign(cohort, overrides);
}

interface FindOneCall {
  entity: unknown;
  where: Record<string, unknown>;
}

interface MockRouting {
  // findOne results, keyed by entity constructor - each is consumed as a
  // FIFO queue so a test can express "first call returns X, second
  // returns Y" for repeated lookups of the same entity type (e.g.
  // transferOwnership loading two different memberships/role assignments).
  groupResults?: (Group | null)[];
  userResults?: (User | null)[];
  membershipResults?: (GroupMembership | null)[];
  cohortResults?: (Cohort | null)[];
  membershipCohortResults?: (MembershipCohort | null)[];
  roleAssignmentResults?: (RoleAssignment | null)[];
  groupBanResults?: (GroupBan | null)[];
  membershipSuspensionResults?: (MembershipSuspension | null)[];
  // find (bulk) results, keyed by entity constructor. Not a FIFO queue -
  // every call to find() for the same entity gets the same static array,
  // which is enough for these tests since none of them depend on two
  // *different* bulk-find results for the same entity within one test.
  membershipCohortFindResults?: MembershipCohort[];
  roleAssignmentFindResults?: RoleAssignment[];
  flushError?: Error;
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const userQueue = [...(routing.userResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const cohortQueue = [...(routing.cohortResults ?? [])];
  const membershipCohortQueue = [...(routing.membershipCohortResults ?? [])];
  const roleAssignmentQueue = [...(routing.roleAssignmentResults ?? [])];
  const groupBanQueue = [...(routing.groupBanResults ?? [])];
  const membershipSuspensionQueue = [
    ...(routing.membershipSuspensionResults ?? []),
  ];

  const findOneCalls: FindOneCall[] = [];

  const flush = routing.flushError
    ? jest.fn().mockRejectedValue(routing.flushError)
    : jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });
  const remove = jest.fn().mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown, where: Record<string, unknown>) => {
    findOneCalls.push({ entity, where });
    if (entity === Group) {
      return Promise.resolve(groupQueue.shift() ?? null);
    }
    if (entity === User) {
      return Promise.resolve(userQueue.shift() ?? null);
    }
    if (entity === GroupMembership) {
      return Promise.resolve(membershipQueue.shift() ?? null);
    }
    if (entity === Cohort) {
      return Promise.resolve(cohortQueue.shift() ?? null);
    }
    if (entity === MembershipCohort) {
      return Promise.resolve(membershipCohortQueue.shift() ?? null);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(roleAssignmentQueue.shift() ?? null);
    }
    if (entity === GroupBan) {
      return Promise.resolve(groupBanQueue.shift() ?? null);
    }
    if (entity === MembershipSuspension) {
      return Promise.resolve(membershipSuspensionQueue.shift() ?? null);
    }
    throw new Error(
      `Unexpected findOne entity in test mock: ${String(entity)}`,
    );
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === MembershipCohort) {
      return Promise.resolve(routing.membershipCohortFindResults ?? []);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleAssignmentFindResults ?? []);
    }
    throw new Error(`Unexpected find entity in test mock: ${String(entity)}`);
  });

  const getReference = jest
    .fn()
    .mockImplementation((_entity: unknown, id: string) => ({ id }));

  const raw = {
    findOne,
    find,
    persist,
    remove,
    getReference,
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
    findOneCalls,
  };
}

function buildService(
  em: EntityManager,
  getRootGroupImpl?: (groupId: string, em?: EntityManager) => Promise<Group>,
  getDescendantsImpl?: (groupId: string) => Promise<Group[]>,
  auditLogServiceOverride?: AuditLogService,
) {
  const resolveGetRootGroup =
    getRootGroupImpl ?? (() => Promise.resolve(buildGroup()));
  const groupHierarchyService = {
    getRootGroup: resolveGetRootGroup,
    getDescendants: getDescendantsImpl ?? (() => Promise.resolve([])),
    getDescendantSections: () => Promise.resolve([]),
    findCommunityById: (id: string, emArg?: EntityManager) =>
      (emArg ?? em).findOne(Group, { id }),
    resolveRootGroup: (community: Group, emArg?: EntityManager) =>
      resolveGetRootGroup(community.id, emArg),
  } as unknown as GroupHierarchyService;
  const auditLogService =
    auditLogServiceOverride ??
    ({
      record: jest.fn().mockResolvedValue(undefined),
    } as unknown as AuditLogService);
  const roleAssignmentsService = new RoleAssignmentsService(
    em,
    groupHierarchyService,
    auditLogService,
  );

  return new GroupMembershipsService(
    em,
    groupHierarchyService,
    roleAssignmentsService,
    auditLogService,
  );
}

function buildAuditLogServiceMock(): AuditLogService & { record: jest.Mock } {
  return { record: jest.fn() } as unknown as AuditLogService & {
    record: jest.Mock;
  };
}

describe('GroupMembershipsService', () => {
  describe('addMember', () => {
    it('creates a new active membership and automatically grants MEMBER for the Root Group', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [null],
        // ensureMemberRole's existence check - no MEMBER row yet.
        roleAssignmentResults: [null],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.MEMBER }),
        ],
      });
      const service = buildService(em);

      const result = await service.addMember('root-1', {
        userId: 'user-2',
        role: GroupRole.MEMBER,
      });

      const persistedMembership = persist.mock.calls[0][0] as GroupMembership;
      expect(persistedMembership.user).toBe(user);
      expect(persistedMembership.rootGroup.id).toBe('root-1');

      const persistedMemberRole = persist.mock.calls[1][0] as RoleAssignment;
      expect(persistedMemberRole.role).toBe(GroupRole.MEMBER);
      expect(persistedMemberRole.membership).toBe(persistedMembership);
      expect(persistedMemberRole.group).toBe(persistedMembership.rootGroup);
      // Requesting MEMBER explicitly does not create a second row on top
      // of the automatic grant.
      expect(persist).toHaveBeenCalledTimes(2);
      expect(result.rootRoles).toEqual([GroupRole.MEMBER]);
    });

    it('grants the requested Role in addition to the automatic MEMBER grant when they differ', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [null],
        roleAssignmentResults: [null],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.MEMBER }),
          buildRoleAssignment({ role: GroupRole.ADMIN }),
        ],
      });
      const service = buildService(em);

      const result = await service.addMember('root-1', {
        userId: 'user-2',
        role: GroupRole.ADMIN,
      });

      expect(persist).toHaveBeenCalledTimes(3);
      const persistedMemberRole = persist.mock.calls[1][0] as RoleAssignment;
      const persistedAdminRole = persist.mock.calls[2][0] as RoleAssignment;
      expect(persistedMemberRole.role).toBe(GroupRole.MEMBER);
      expect(persistedAdminRole.role).toBe(GroupRole.ADMIN);
      expect(result.rootRoles).toEqual([GroupRole.MEMBER, GroupRole.ADMIN]);
    });

    it('creates only the Membership and no Role Assignment when role is omitted - belongs to the organization, not yet assigned to any Group', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [null],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      const result = await service.addMember('root-1', {
        userId: 'user-2',
      });

      // Only the Membership itself is persisted - no Role Assignment, not
      // even MEMBER (see ADR-028/ADR-004: Membership never implies any
      // Role in the Root Group by itself).
      expect(persist).toHaveBeenCalledTimes(1);
      const persistedMembership = persist.mock.calls[0][0] as GroupMembership;
      expect(persistedMembership.user).toBe(user);
      expect(result.rootRoles).toEqual([]);
    });

    it('rejects with MEMBERSHIP_ROOT_GROUP_MISMATCH when the target group is a Child Group', async () => {
      const childGroup = buildGroup({ id: 'child-1' });
      childGroup.parentGroup = buildGroup({ id: 'root-1' });
      const { em } = buildMockEm({ groupResults: [childGroup] });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('child-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_ROOT_GROUP_MISMATCH',
      });
    });

    it('rejects with GROUP_NOT_FOUND when the root group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      await expect(
        service.addMember('missing', {
          userId: 'user-2',
          role: GroupRole.MEMBER,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects with USER_NOT_FOUND when the target user does not exist', async () => {
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('root-1', { userId: 'missing', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'USER_NOT_FOUND',
      });
    });

    it('rejects with ALREADY_A_MEMBER when the user already has an active membership in this Root Group', async () => {
      const user = new User();
      user.id = 'user-2';
      const existingMembership = buildMembership();
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [existingMembership],
      });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('root-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_A_MEMBER',
      });
    });

    it('allows the same user to have active memberships in two different Root Groups', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup({ id: 'root-2' })],
        userResults: [user],
        // No existing membership found *for root-2* - a membership the
        // user holds elsewhere (root-1) is a different Root Group and is
        // simply never looked up here (loadActiveMembership is always
        // scoped to the target rootGroupId).
        membershipResults: [null],
        roleAssignmentResults: [null],
      });
      const service = buildService(em);

      await service.addMember('root-2', {
        userId: 'user-2',
        role: GroupRole.MEMBER,
      });

      const persisted = persist.mock.calls[0][0] as GroupMembership;
      expect(persisted.rootGroup.id).toBe('root-2');
    });

    it('maps a database-level unique-violation race to ALREADY_A_MEMBER instead of a raw DB error', async () => {
      const user = new User();
      user.id = 'user-2';
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        userResults: [user],
        membershipResults: [null],
        roleAssignmentResults: [null],
        flushError: new UniqueConstraintViolationException(
          new Error(
            `duplicate key value violates unique constraint "${GROUP_MEMBERSHIPS_ACTIVE_UNIQUE_INDEX}"`,
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .addMember('root-1', { userId: 'user-2', role: GroupRole.MEMBER })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_A_MEMBER',
      });
    });
  });

  describe('getMembership', () => {
    it('returns a membership regardless of status - history remains readable', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.ARCHIVED,
        endReason: MembershipEndReason.LEFT,
        leftAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.MEMBER }),
          buildRoleAssignment({ role: GroupRole.ADMIN }),
        ],
      });
      const service = buildService(em);

      const result = await service.getMembership('root-1', 'membership-1');

      expect(result.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(result.endReason).toBe(MembershipEndReason.LEFT);
      expect(result.rootRoles).toEqual([GroupRole.MEMBER, GroupRole.ADMIN]);
    });

    it('returns an empty rootRoles array when no Role Assignment is found for this Group', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      const result = await service.getMembership('root-1', 'membership-1');

      expect(result.rootRoles).toEqual([]);
    });

    it('throws MEMBERSHIP_NOT_FOUND when the membership does not exist', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .getMembership('root-1', 'missing')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_FOUND',
      });
    });
  });

  describe('removeMember', () => {
    it('archives the membership with endReason REMOVED, preserving history and every Role Assignment', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        // findOwnedActiveGroups(OWNER) check - owns nothing.
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.removeMember('root-1', 'membership-1', ACTOR);

      expect(membership.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(membership.endReason).toBe(MembershipEndReason.REMOVED);
      expect(membership.leftAt).not.toBeNull();
    });

    it('rejects with CANNOT_REMOVE_OWNER when the target owns the Root Group (even alongside other Roles)', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: buildGroup() }),
        ],
      });
      const service = buildService(em);

      const error: unknown = await service
        .removeMember('root-1', 'membership-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_OWNER',
        ownedGroupIds: ['root-1'],
      });
    });

    it('rejects with CANNOT_REMOVE_OWNER when the target owns a Child Group, not the Root Group itself', async () => {
      const membership = buildMembership();
      const childGroup = buildGroup({
        id: 'child-1',
        parentGroup: buildGroup({ id: 'root-1' }),
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: childGroup }),
        ],
      });
      const service = buildService(em, undefined, () =>
        Promise.resolve([childGroup]),
      );

      const error: unknown = await service
        .removeMember('root-1', 'membership-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_REMOVE_OWNER',
        ownedGroupIds: ['child-1'],
      });
    });
  });

  describe('leave', () => {
    it('archives the membership with endReason LEFT for a non-owner', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.leave('root-1', ACTOR);

      expect(membership.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(membership.endReason).toBe(MembershipEndReason.LEFT);
      expect(membership.leftAt).not.toBeNull();
    });

    it('rejects with OWNER_MUST_TRANSFER_OWNERSHIP when the caller owns the Root Group', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: buildGroup() }),
        ],
      });
      const service = buildService(em);

      const error: unknown = await service
        .leave('root-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
      });
    });

    it('rejects with OWNER_MUST_TRANSFER_OWNERSHIP when the caller owns one or more Child Groups, even without owning the Root Group', async () => {
      const membership = buildMembership();
      const child1 = buildGroup({
        id: 'child-1',
        parentGroup: buildGroup({ id: 'root-1' }),
      });
      const child2 = buildGroup({
        id: 'child-2',
        parentGroup: buildGroup({ id: 'root-1' }),
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: child1 }),
          buildRoleAssignment({ role: GroupRole.OWNER, group: child2 }),
        ],
      });
      const service = buildService(em, undefined, () =>
        Promise.resolve([child1, child2]),
      );

      const error: unknown = await service
        .leave('root-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'OWNER_MUST_TRANSFER_OWNERSHIP',
        ownedGroupIds: ['child-1', 'child-2'],
      });
    });

    it('ignores an OWNER Role Assignment on an archived Group', async () => {
      const membership = buildMembership();
      const archivedGroup = buildGroup({
        id: 'child-archived',
        parentGroup: buildGroup({ id: 'root-1' }),
        status: GroupStatus.ARCHIVED,
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: archivedGroup }),
        ],
      });
      const service = buildService(em, undefined, () =>
        Promise.resolve([archivedGroup]),
      );

      await service.leave('root-1', ACTOR);

      expect(membership.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(membership.endReason).toBe(MembershipEndReason.LEFT);
    });
  });

  describe('transferOwnership', () => {
    it('rejects transferring to self', async () => {
      const { em } = buildMockEm();
      const service = buildService(em);

      const error: unknown = await service
        .transferOwnership(
          'root-1',
          'user-1',
          {
            newOwnerUserId: 'user-1',
          },
          ACTOR,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'CANNOT_TRANSFER_TO_SELF',
      });
    });

    it('rejects with TARGET_NOT_A_MEMBER when the new owner has no active membership', async () => {
      const previousOwner = buildMembership({ id: 'membership-owner' });
      const previousOwnerAssignment = buildRoleAssignment({
        membership: previousOwner,
        role: GroupRole.OWNER,
      });
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        membershipResults: [previousOwner, null],
        roleAssignmentResults: [previousOwnerAssignment],
      });
      const service = buildService(em);

      const error: unknown = await service
        .transferOwnership(
          'root-1',
          'user-1',
          {
            newOwnerUserId: 'user-2',
          },
          ACTOR,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'TARGET_NOT_A_MEMBER',
      });
    });

    it('rejects with MEMBERSHIP_NOT_FOUND when the caller does not hold an OWNER Role Assignment', async () => {
      const previousOwner = buildMembership({ id: 'membership-owner' });
      const { em } = buildMockEm({
        groupResults: [buildGroup()],
        membershipResults: [previousOwner],
        // findRoleAssignment(OWNER) - not found.
        roleAssignmentResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .transferOwnership(
          'root-1',
          'user-1',
          {
            newOwnerUserId: 'user-2',
          },
          ACTOR,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_FOUND',
      });
    });

    it('atomically removes the OWNER Role Assignment from the previous owner and grants it to the target, leaving every other Role untouched', async () => {
      const previousOwner = buildMembership({ id: 'membership-owner' });
      const newOwner = buildMembership({ id: 'membership-target' });
      const previousOwnerAssignment = buildRoleAssignment({
        membership: previousOwner,
        role: GroupRole.OWNER,
      });
      // The new owner already holds MEMBER for this Root Group (granted
      // automatically when they joined) - ensureMemberRole finds it and
      // does not create a duplicate.
      const newOwnerMemberAssignment = buildRoleAssignment({
        membership: newOwner,
        role: GroupRole.MEMBER,
      });
      const { em, persist, remove } = buildMockEm({
        groupResults: [buildGroup()],
        membershipResults: [previousOwner, newOwner],
        roleAssignmentResults: [
          previousOwnerAssignment,
          newOwnerMemberAssignment,
        ],
      });
      const service = buildService(em);

      await service.transferOwnership(
        'root-1',
        'user-1',
        {
          newOwnerUserId: 'user-2',
        },
        ACTOR,
      );

      expect(remove).toHaveBeenCalledWith(previousOwnerAssignment);
      // ensureMemberRole found an existing MEMBER row, so the only new
      // persist is the new owner's OWNER Role Assignment.
      expect(persist).toHaveBeenCalledTimes(1);
      const grantedOwnerRole = persist.mock.calls[0][0] as RoleAssignment;
      expect(grantedOwnerRole.role).toBe(GroupRole.OWNER);
      expect(grantedOwnerRole.membership).toBe(newOwner);
    });

    it("also grants MEMBER to the target when they somehow don't already hold it for this Root Group", async () => {
      const previousOwner = buildMembership({ id: 'membership-owner' });
      const newOwner = buildMembership({ id: 'membership-target' });
      const previousOwnerAssignment = buildRoleAssignment({
        membership: previousOwner,
        role: GroupRole.OWNER,
      });
      const { em, persist } = buildMockEm({
        groupResults: [buildGroup()],
        membershipResults: [previousOwner, newOwner],
        // OWNER check finds a row; ensureMemberRole's MEMBER check finds
        // nothing, so it must create one.
        roleAssignmentResults: [previousOwnerAssignment, null],
      });
      const service = buildService(em);

      await service.transferOwnership(
        'root-1',
        'user-1',
        {
          newOwnerUserId: 'user-2',
        },
        ACTOR,
      );

      expect(persist).toHaveBeenCalledTimes(2);
      const grantedMemberRole = persist.mock.calls[0][0] as RoleAssignment;
      const grantedOwnerRole = persist.mock.calls[1][0] as RoleAssignment;
      expect(grantedMemberRole.role).toBe(GroupRole.MEMBER);
      expect(grantedOwnerRole.role).toBe(GroupRole.OWNER);
    });

    it('rejects with GROUP_NOT_FOUND when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .transferOwnership(
          'missing-group',
          'user-1',
          {
            newOwnerUserId: 'user-2',
          },
          ACTOR,
        )
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'GROUP_NOT_FOUND',
      });
    });

    it('works for a Child Group: looks up both memberships against the Root Group, but targets the Role Assignment at the Child Group itself', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const childGroup = buildGroup({ id: 'child-1', parentGroup: rootGroup });
      const previousOwner = buildMembership({ id: 'membership-owner' });
      const newOwner = buildMembership({ id: 'membership-target' });
      const previousOwnerAssignment = buildRoleAssignment({
        membership: previousOwner,
        group: childGroup,
        role: GroupRole.OWNER,
      });
      const newOwnerMemberAssignment = buildRoleAssignment({
        membership: newOwner,
        group: childGroup,
        role: GroupRole.MEMBER,
      });
      const { em, persist, remove } = buildMockEm({
        groupResults: [childGroup],
        membershipResults: [previousOwner, newOwner],
        roleAssignmentResults: [
          previousOwnerAssignment,
          newOwnerMemberAssignment,
        ],
      });
      const service = buildService(em, (groupId) => {
        expect(groupId).toBe('child-1');
        return Promise.resolve(rootGroup);
      });

      await service.transferOwnership(
        'child-1',
        'user-1',
        {
          newOwnerUserId: 'user-2',
        },
        ACTOR,
      );

      expect(remove).toHaveBeenCalledWith(previousOwnerAssignment);
      const grantedOwnerRole = persist.mock.calls[0][0] as RoleAssignment;
      expect(grantedOwnerRole.role).toBe(GroupRole.OWNER);
      expect(grantedOwnerRole.group).toBe(childGroup);
      expect(grantedOwnerRole.membership).toBe(newOwner);
    });
  });

  describe('assignCohort', () => {
    it('assigns an active membership to a cohort in the same Root Group', async () => {
      const membership = buildMembership();
      const cohort = buildCohort();
      const { em, persist } = buildMockEm({
        membershipResults: [membership],
        cohortResults: [cohort],
        membershipCohortResults: [null],
      });
      const service = buildService(em, () => Promise.resolve(buildGroup()));

      await service.assignCohort('root-1', 'membership-1', 'cohort-1');

      const persisted = persist.mock.calls[0][0] as MembershipCohort;
      expect(persisted.membership).toEqual({ id: 'membership-1' });
      expect(persisted.cohort).toEqual({ id: 'cohort-1' });
    });

    it('rejects assigning a cohort to an inactive membership', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.ARCHIVED,
      });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const error: unknown = await service
        .assignCohort('root-1', 'membership-1', 'cohort-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_ACTIVE',
      });
    });

    it('rejects with COHORT_NOT_FOUND when the cohort does not exist', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        cohortResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignCohort('root-1', 'membership-1', 'missing')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'COHORT_NOT_FOUND',
      });
    });

    it('rejects assigning an archived cohort', async () => {
      const membership = buildMembership();
      const cohort = buildCohort({ status: CohortStatus.ARCHIVED });
      const { em } = buildMockEm({
        membershipResults: [membership],
        cohortResults: [cohort],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignCohort('root-1', 'membership-1', 'cohort-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_COHORT_ARCHIVED',
      });
    });

    it('rejects a cohort belonging to a different Root Group', async () => {
      const membership = buildMembership();
      const cohort = buildCohort({
        group: buildGroup({ id: 'child-of-other-root' }),
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        cohortResults: [cohort],
      });
      const service = buildService(em, () =>
        Promise.resolve(buildGroup({ id: 'other-root' })),
      );

      const error: unknown = await service
        .assignCohort('root-1', 'membership-1', 'cohort-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_COHORT_MISMATCH',
      });
    });

    it('rejects a duplicate assignment', async () => {
      const membership = buildMembership();
      const cohort = buildCohort();
      const existingAssignment = new MembershipCohort();
      const { em } = buildMockEm({
        membershipResults: [membership],
        cohortResults: [cohort],
        membershipCohortResults: [existingAssignment],
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignCohort('root-1', 'membership-1', 'cohort-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_COHORT_ALREADY_ASSIGNED',
      });
    });

    it('maps a database-level unique-violation race to MEMBERSHIP_COHORT_ALREADY_ASSIGNED', async () => {
      const membership = buildMembership();
      const cohort = buildCohort();
      const { em } = buildMockEm({
        membershipResults: [membership],
        cohortResults: [cohort],
        membershipCohortResults: [null],
        flushError: new UniqueConstraintViolationException(
          new Error(
            'duplicate key value violates unique constraint "membership_cohorts_membership_id_cohort_id_unique"',
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .assignCohort('root-1', 'membership-1', 'cohort-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_COHORT_ALREADY_ASSIGNED',
      });
    });
  });

  describe('unassignCohort', () => {
    it('removes an existing assignment', async () => {
      const membership = buildMembership();
      const assignment = new MembershipCohort();
      const { em, remove } = buildMockEm({
        membershipResults: [membership],
        membershipCohortResults: [assignment],
      });
      const service = buildService(em);

      await service.unassignCohort('root-1', 'membership-1', 'cohort-1');

      expect(remove).toHaveBeenCalledWith(assignment);
    });

    it('throws MEMBERSHIP_COHORT_ASSIGNMENT_NOT_FOUND when no assignment exists', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        membershipCohortResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .unassignCohort('root-1', 'membership-1', 'cohort-1')
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_COHORT_ASSIGNMENT_NOT_FOUND',
      });
    });
  });

  describe('banMember', () => {
    it('archives the membership with endReason BANNED, records a GroupBan, and audit-logs BAN', async () => {
      const membership = buildMembership();
      const auditLogService = buildAuditLogServiceMock();
      const { em, persist } = buildMockEm({
        membershipResults: [membership],
        // findOwnedActiveGroups(OWNER) check - owns nothing.
        roleAssignmentFindResults: [],
      });
      const service = buildService(em, undefined, undefined, auditLogService);

      await service.banMember(
        'root-1',
        'membership-1',
        ACTOR,
        'Repeated violations',
      );

      expect(membership.status).toBe(GroupMembershipStatus.ARCHIVED);
      expect(membership.endReason).toBe(MembershipEndReason.BANNED);
      expect(membership.leftAt).not.toBeNull();

      const persistedBan = persist.mock.calls[0][0] as GroupBan;
      expect(persistedBan.rootGroup).toBe(membership.rootGroup);
      expect(persistedBan.user).toBe(membership.user);
      expect(persistedBan.bannedBy).toBe(ACTOR);
      expect(persistedBan.reason).toBe('Repeated violations');
      expect(persistedBan.liftedAt).toBeNull();

      expect(auditLogService.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({
          community: membership.rootGroup,
          action: AuditAction.BAN,
          actor: ACTOR,
          targetId: membership.user.id,
          description: 'Repeated violations',
        }),
      );
    });

    it('persists a null reason as-is when none is given', async () => {
      const membership = buildMembership();
      const { em, persist } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em);

      await service.banMember('root-1', 'membership-1', ACTOR, null);

      const persistedBan = persist.mock.calls[0][0] as GroupBan;
      expect(persistedBan.reason).toBeNull();
    });

    it('rejects with CANNOT_BAN_OWNER when the target owns one or more Groups in this Group', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [
          buildRoleAssignment({ role: GroupRole.OWNER, group: buildGroup() }),
        ],
      });
      const service = buildService(em);

      const error: unknown = await service
        .banMember('root-1', 'membership-1', ACTOR, null)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CANNOT_BAN_OWNER',
        ownedGroupIds: ['root-1'],
      });
    });

    it('maps a database-level unique-violation race to ALREADY_BANNED', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [],
        flushError: new UniqueConstraintViolationException(
          new Error(
            `duplicate key value violates unique constraint "${GROUP_BANS_ACTIVE_UNIQUE_INDEX}"`,
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .banMember('root-1', 'membership-1', ACTOR, null)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'ALREADY_BANNED',
      });
    });

    it('rejects with MEMBERSHIP_NOT_FOUND when the target membership is not active', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      const error: unknown = await service
        .banMember('root-1', 'missing', ACTOR, null)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_FOUND',
      });
    });
  });

  describe('unbanMember', () => {
    it('lifts an active ban and audit-logs UNBAN, without touching the (already-ended) membership', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.ARCHIVED,
        endReason: MembershipEndReason.BANNED,
      });
      const ban = new GroupBan();
      ban.rootGroup = buildGroup();
      ban.user = membership.user;
      const auditLogService = buildAuditLogServiceMock();
      const { em } = buildMockEm({
        membershipResults: [membership],
        groupBanResults: [ban],
      });
      const service = buildService(em, undefined, undefined, auditLogService);

      await service.unbanMember('root-1', 'membership-1', ACTOR);

      expect(ban.liftedAt).not.toBeNull();
      expect(ban.liftedBy).toBe(ACTOR);
      expect(auditLogService.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({
          community: membership.rootGroup,
          action: AuditAction.UNBAN,
          actor: ACTOR,
          targetId: membership.user.id,
        }),
      );
    });

    it('rejects with BAN_NOT_FOUND when the user is not currently banned', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        groupBanResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .unbanMember('root-1', 'membership-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'BAN_NOT_FOUND',
      });
    });

    it('rejects with MEMBERSHIP_NOT_FOUND when the membership does not exist at all', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      await expect(
        service.unbanMember('root-1', 'missing', ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('suspendMember', () => {
    it('sets the membership to READ_ONLY, records a MembershipSuspension, and audit-logs SUSPEND with the until date', async () => {
      const membership = buildMembership();
      const auditLogService = buildAuditLogServiceMock();
      const { em, persist } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em, undefined, undefined, auditLogService);
      const until = new Date('2026-12-31T00:00:00.000Z');

      const result = await service.suspendMember(
        'root-1',
        'membership-1',
        ACTOR,
        until,
        'Taking a break',
      );

      expect(membership.status).toBe(GroupMembershipStatus.READ_ONLY);
      const persistedSuspension = persist.mock
        .calls[0][0] as MembershipSuspension;
      expect(persistedSuspension.membership).toBe(membership);
      expect(persistedSuspension.suspendedBy).toBe(ACTOR);
      expect(persistedSuspension.until).toBe(until);
      expect(persistedSuspension.reason).toBe('Taking a break');

      expect(auditLogService.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({
          action: AuditAction.SUSPEND,
          metadata: { until: until.toISOString() },
        }),
      );
      expect(result.status).toBe(GroupMembershipStatus.READ_ONLY);
    });

    it('supports an indefinite suspension (until=null), recorded as metadata.until=null', async () => {
      const membership = buildMembership();
      const auditLogService = buildAuditLogServiceMock();
      const { em, persist } = buildMockEm({
        membershipResults: [membership],
        roleAssignmentFindResults: [],
      });
      const service = buildService(em, undefined, undefined, auditLogService);

      await service.suspendMember('root-1', 'membership-1', ACTOR, null, null);

      const persistedSuspension = persist.mock
        .calls[0][0] as MembershipSuspension;
      expect(persistedSuspension.until).toBeNull();
      expect(persistedSuspension.reason).toBeNull();
      expect(auditLogService.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({ metadata: { until: null } }),
      );
    });

    it('does not exempt an OWNER from being suspended (unlike ban/remove/leave)', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
      });
      const service = buildService(em);

      await service.suspendMember('root-1', 'membership-1', ACTOR, null, null);

      expect(membership.status).toBe(GroupMembershipStatus.READ_ONLY);
    });

    it('maps a database-level unique-violation race to MEMBERSHIP_ALREADY_SUSPENDED', async () => {
      const membership = buildMembership();
      const { em } = buildMockEm({
        membershipResults: [membership],
        flushError: new UniqueConstraintViolationException(
          new Error(
            `duplicate key value violates unique constraint "${MEMBERSHIP_SUSPENSIONS_ACTIVE_UNIQUE_INDEX}"`,
          ),
        ),
      });
      const service = buildService(em);

      const error: unknown = await service
        .suspendMember('root-1', 'membership-1', ACTOR, null, null)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_ALREADY_SUSPENDED',
      });
    });

    it('rejects with MEMBERSHIP_NOT_FOUND when the target membership is not active', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      await expect(
        service.suspendMember('root-1', 'missing', ACTOR, null, null),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('unsuspendMember', () => {
    it('restores the membership to ACTIVE, lifts the suspension, and audit-logs UNSUSPEND', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.READ_ONLY,
      });
      const suspension = new MembershipSuspension();
      suspension.membership = membership;
      const auditLogService = buildAuditLogServiceMock();
      const { em } = buildMockEm({
        membershipResults: [membership],
        membershipSuspensionResults: [suspension],
      });
      const service = buildService(em, undefined, undefined, auditLogService);

      const result = await service.unsuspendMember(
        'root-1',
        'membership-1',
        ACTOR,
      );

      expect(membership.status).toBe(GroupMembershipStatus.ACTIVE);
      expect(suspension.liftedAt).not.toBeNull();
      expect(suspension.liftedBy).toBe(ACTOR);
      expect(auditLogService.record).toHaveBeenCalledWith(
        em,
        expect.objectContaining({
          action: AuditAction.UNSUSPEND,
          targetId: membership.user.id,
        }),
      );
      expect(result.status).toBe(GroupMembershipStatus.ACTIVE);
    });

    it('rejects with MEMBERSHIP_NOT_SUSPENDED when the membership is not currently READ_ONLY', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.ACTIVE,
      });
      const { em } = buildMockEm({ membershipResults: [membership] });
      const service = buildService(em);

      const error: unknown = await service
        .unsuspendMember('root-1', 'membership-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'MEMBERSHIP_NOT_SUSPENDED',
      });
    });

    it('rejects with SUSPENSION_NOT_FOUND when READ_ONLY but no active suspension row exists', async () => {
      const membership = buildMembership({
        status: GroupMembershipStatus.READ_ONLY,
      });
      const { em } = buildMockEm({
        membershipResults: [membership],
        membershipSuspensionResults: [null],
      });
      const service = buildService(em);

      const error: unknown = await service
        .unsuspendMember('root-1', 'membership-1', ACTOR)
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect((error as NotFoundException).getResponse()).toMatchObject({
        code: 'SUSPENSION_NOT_FOUND',
      });
    });

    it('rejects with MEMBERSHIP_NOT_FOUND when the membership does not exist at all', async () => {
      const { em } = buildMockEm({ membershipResults: [null] });
      const service = buildService(em);

      await expect(
        service.unsuspendMember('root-1', 'missing', ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
