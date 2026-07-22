import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateGroupInput } from './dto/create-group.schema';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';
import { GroupsService } from './groups.service';
import { GroupPermissionService } from './permissions/group-permission.service';
import { RoleAssignmentsService } from './role-assignments.service';

function buildCreateInput(
  overrides: Partial<CreateGroupInput> = {},
): CreateGroupInput {
  return {
    parentGroupId: null,
    name: 'Capoeira Angola SP',
    description: null,
    logoUrl: null,
    coverImageUrl: null,
    contactEmail: null,
    contactPhone: null,
    websiteUrl: null,
    facebookUrl: null,
    instagramUrl: null,
    youtubeUrl: null,
    isPublic: true,
    isHidden: false,
    memberInvitesAllowed: false,
    timezone: 'Europe/Warsaw',
    currencyCode: 'PLN',
    ...overrides,
  };
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  return Object.assign(user, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
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
  membership.rootGroup = buildGroup({ id: 'parent-1' });
  return Object.assign(membership, overrides);
}

function buildRoleAssignment(
  overrides: Partial<RoleAssignment> = {},
): RoleAssignment {
  const assignment = new RoleAssignment();
  assignment.id = 'role-assignment-1';
  assignment.role = GroupRole.MEMBER;
  assignment.membership = buildMembership();
  assignment.group = buildGroup({ id: 'parent-1' });
  assignment.grantedAt = new Date('2026-01-01T00:00:00.000Z');
  return Object.assign(assignment, overrides);
}

interface MockRouting {
  groupResults?: (Group | null)[];
  membershipResults?: (GroupMembership | null)[];
  roleAssignmentResults?: (RoleAssignment | null)[];
  memberships?: GroupMembership[];
  roleAssignmentFindResults?: RoleAssignment[];
  children?: Group[];
}

function buildMockEm(routing: MockRouting = {}) {
  const groupQueue = [...(routing.groupResults ?? [])];
  const membershipQueue = [...(routing.membershipResults ?? [])];
  const roleAssignmentQueue = [...(routing.roleAssignmentResults ?? [])];

  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object]>()
    .mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown, filter?: unknown) => {
    // publicCode uniqueness check from generateUniquePublicCode() - always
    // return null to indicate no collision regardless of entity type.
    if (
      filter !== null &&
      typeof filter === 'object' &&
      'publicCode' in (filter as Record<string, unknown>)
    ) {
      return Promise.resolve(null);
    }
    if (entity === Group) {
      return Promise.resolve(groupQueue.shift() ?? null);
    }
    if (entity === GroupMembership) {
      return Promise.resolve(membershipQueue.shift() ?? null);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(roleAssignmentQueue.shift() ?? null);
    }
    // User lookups come from generateUniquePublicCode() - return null
    // to indicate "no existing user has this publicCode".
    if (entity === User) {
      return Promise.resolve(null);
    }
    throw new Error(
      `Unexpected findOne entity in test mock: ${String(entity)}`,
    );
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === GroupMembership) {
      return Promise.resolve(routing.memberships ?? []);
    }
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleAssignmentFindResults ?? []);
    }
    if (entity === Group) {
      return Promise.resolve(routing.children ?? []);
    }
    throw new Error(`Unexpected find entity in test mock: ${String(entity)}`);
  });

  const raw = {
    findOne,
    find,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: EntityManager) => unknown) =>
        cb(raw as never),
      ),
  };

  return { em: raw as unknown as EntityManager, persist, findOne, find };
}

function buildService(em: EntityManager) {
  const groupPermissionService = new GroupPermissionService();
  const groupHierarchyService = {
    getRootGroup: () => Promise.resolve(buildGroup()),
  } as unknown as GroupHierarchyService;
  const roleAssignmentsService = new RoleAssignmentsService(
    em,
    groupHierarchyService,
  );

  return {
    service: new GroupsService(
      em,
      groupPermissionService,
      roleAssignmentsService,
    ),
  };
}

describe('GroupsService', () => {
  describe('create', () => {
    it('creates a Root Group (no parentGroupId), a Membership, and MEMBER + OWNER Role Assignments', async () => {
      const { em, persist } = buildMockEm({
        // ensureMemberRole's existence check - no MEMBER row yet.
        roleAssignmentResults: [null],
      });
      const { service } = buildService(em);
      const user = buildUser();

      await service.create(user, buildCreateInput());

      const persistedEntities = persist.mock.calls[0][0] as unknown[];
      const persistedGroup = (
        Array.isArray(persistedEntities)
          ? persistedEntities
          : [persistedEntities]
      ).find((entity) => entity instanceof Group) as Group;
      const persistedMembership = (
        Array.isArray(persistedEntities)
          ? persistedEntities
          : [persistedEntities]
      ).find((entity) => entity instanceof GroupMembership) as GroupMembership;
      const persistedMemberRole = persist.mock.calls[1][0] as RoleAssignment;
      const persistedOwnerRole = persist.mock.calls[2][0] as RoleAssignment;

      expect(persistedGroup.name).toBe('Capoeira Angola SP');
      expect(persistedGroup.parentGroup).toBeNull();
      expect(persistedMembership.user).toBe(user);
      expect(persistedMembership.rootGroup).toBe(persistedGroup);
      expect(persistedMemberRole.role).toBe(GroupRole.MEMBER);
      expect(persistedOwnerRole.role).toBe(GroupRole.OWNER);
      expect(persistedOwnerRole.membership).toBe(persistedMembership);
      expect(persistedOwnerRole.group).toBe(persistedGroup);
    });

    it('creates a Child Group when the caller has an OWNER Role Assignment (GROUP_EDIT) in the parent, reusing the existing Membership', async () => {
      const parentGroup = buildGroup({ id: 'parent-1' });
      const membership = buildMembership({ rootGroup: parentGroup });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: parentGroup,
        role: GroupRole.OWNER,
      });
      const { em, persist } = buildMockEm({
        groupResults: [parentGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [roleAssignment],
        // ensureMemberRole's existence check for the new Child Group.
        roleAssignmentResults: [null],
      });
      const { service } = buildService(em);
      const user = buildUser();

      await service.create(
        user,
        buildCreateInput({ parentGroupId: 'parent-1' }),
      );

      const persistedGroup = persist.mock.calls[0][0] as Group;
      const persistedMemberRole = persist.mock.calls[1][0] as RoleAssignment;
      const persistedOwnerRole = persist.mock.calls[2][0] as RoleAssignment;

      expect(persistedGroup.parentGroup).toBe(parentGroup);
      // No second Membership is created for a Child Group - the caller's
      // existing Membership in the parent's Root Group is reused.
      expect(persistedMemberRole.membership).toBe(membership);
      expect(persistedMemberRole.role).toBe(GroupRole.MEMBER);
      expect(persistedOwnerRole.membership).toBe(membership);
      expect(persistedOwnerRole.role).toBe(GroupRole.OWNER);
    });

    it('rejects creating a Child Group when the caller has no active membership in the parent', async () => {
      const parentGroup = buildGroup({ id: 'parent-1' });
      const { em } = buildMockEm({
        groupResults: [parentGroup],
        membershipResults: [null],
      });
      const { service } = buildService(em);

      await expect(
        service.create(
          buildUser(),
          buildCreateInput({ parentGroupId: 'parent-1' }),
        ),
      ).rejects.toMatchObject({ response: { code: 'GROUP_PARENT_NOT_FOUND' } });
    });

    it('rejects creating a Child Group when the caller lacks GROUP_EDIT in the parent', async () => {
      const parentGroup = buildGroup({ id: 'parent-1' });
      const membership = buildMembership({ rootGroup: parentGroup });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: parentGroup,
        role: GroupRole.MEMBER,
      });
      const { em } = buildMockEm({
        groupResults: [parentGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [roleAssignment],
      });
      const { service } = buildService(em);

      const promise = service.create(
        buildUser(),
        buildCreateInput({ parentGroupId: 'parent-1' }),
      );

      await expect(promise).rejects.toBeInstanceOf(ForbiddenException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'INSUFFICIENT_GROUP_PERMISSIONS' },
      });
    });

    it('rejects creating a Child Group under an archived parent', async () => {
      const parentGroup = buildGroup({
        id: 'parent-1',
        status: GroupStatus.ARCHIVED,
      });
      const membership = buildMembership({ rootGroup: parentGroup });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: parentGroup,
        role: GroupRole.OWNER,
      });
      const { em } = buildMockEm({
        groupResults: [parentGroup],
        membershipResults: [membership],
        roleAssignmentFindResults: [roleAssignment],
      });
      const { service } = buildService(em);

      await expect(
        service.create(
          buildUser(),
          buildCreateInput({ parentGroupId: 'parent-1' }),
        ),
      ).rejects.toMatchObject({ response: { code: 'GROUP_ARCHIVED' } });
    });
  });

  describe('listChildren', () => {
    it('returns the direct children of a group', async () => {
      const children = [
        buildGroup({ id: 'child-1' }),
        buildGroup({ id: 'child-2' }),
      ];
      const { em } = buildMockEm({ children });
      const { service } = buildService(em);

      const result = await service.listChildren('group-1');

      expect(result.map((child) => child.id)).toEqual(['child-1', 'child-2']);
    });
  });

  describe('listMine', () => {
    it('maps each active membership to a summary with myRoles set from every Root Group Role Assignment it holds', async () => {
      const rootGroup = buildGroup({ id: 'group-1', name: 'Grupo Axé' });
      const membership = buildMembership({
        id: 'membership-1',
        rootGroup,
      });
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
        memberships: [membership],
        roleAssignmentFindResults: [memberRole, adminRole],
      });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Grupo Axé',
          myRoles: [GroupRole.MEMBER, GroupRole.ADMIN],
        }),
      ]);
    });

    it('sets myRoles to an empty array when no Role Assignment is found for the Root Group', async () => {
      const rootGroup = buildGroup({ id: 'group-1', name: 'Grupo Axé' });
      const membership = buildMembership({ id: 'membership-1', rootGroup });
      const { em } = buildMockEm({
        memberships: [membership],
        roleAssignmentFindResults: [],
      });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({ name: 'Grupo Axé', myRoles: [] }),
      ]);
    });

    it('includes groups with status ARCHIVED - archiving never touches membership', async () => {
      const rootGroup = buildGroup({
        id: 'group-1',
        name: 'Archived Group',
        status: GroupStatus.ARCHIVED,
      });
      const membership = buildMembership({ id: 'membership-1', rootGroup });
      const roleAssignment = buildRoleAssignment({
        membership,
        group: rootGroup,
        role: GroupRole.OWNER,
      });
      const { em } = buildMockEm({
        memberships: [membership],
        roleAssignmentFindResults: [roleAssignment],
      });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({
          name: 'Archived Group',
          status: GroupStatus.ARCHIVED,
        }),
      ]);
    });
  });

  describe('getById', () => {
    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const { service } = buildService(em);

      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildGroup({ name: 'Old Name' });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.update('group-1', buildCreateInput({ name: 'New Name' }));

      expect(existing.name).toBe('New Name');
    });
  });

  // Whether a transition is actually allowed from the group's current
  // status is decided by GroupPermissionsGuard before these ever run (see
  // group-write-policy.ts) - these methods just apply the target status, so
  // the tests only check that.
  describe('archive', () => {
    it('sets status to ARCHIVED', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.archive('group-1');

      expect(existing.status).toBe(GroupStatus.ARCHIVED);
    });

    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ groupResults: [null] });
      const { service } = buildService(em);

      await expect(service.archive('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('unarchive', () => {
    it('sets status back to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.ARCHIVED });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.unarchive('group-1');

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });

  describe('setReadOnly', () => {
    it('sets status to READ_ONLY', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.setReadOnly('group-1');

      expect(existing.status).toBe(GroupStatus.READ_ONLY);
    });
  });

  describe('activate', () => {
    it('sets status to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.READ_ONLY });
      const { em } = buildMockEm({ groupResults: [existing] });
      const { service } = buildService(em);

      await service.activate('group-1');

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });
});
