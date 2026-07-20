import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateGroupInput } from './dto/create-group.schema';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupVisibility } from './enums/group-visibility.enum';
import { GroupsService } from './groups.service';
import { GroupPermissionService } from './permissions/group-permission.service';

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
    visibility: GroupVisibility.PUBLIC,
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
  return Object.assign(group, overrides);
}

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.role = GroupRole.ADMIN;
  membership.status = GroupMembershipStatus.ACTIVE;
  membership.rootGroup = buildGroup({ id: 'parent-1' });
  return Object.assign(membership, overrides);
}

interface MockRouting {
  group?: Group | null;
  memberships?: GroupMembership[];
  parentMembership?: GroupMembership | null;
  children?: Group[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object[]]>()
    .mockReturnValue({ flush });

  const findOne = jest.fn((entity: unknown) => {
    if (entity === GroupMembership) {
      // Mirrors loadActiveMembership's query shape: { group, user, status }.
      return Promise.resolve(
        routing.parentMembership === undefined
          ? null
          : routing.parentMembership,
      );
    }
    return Promise.resolve(
      routing.group === undefined ? buildGroup() : routing.group,
    );
  });

  const find = jest.fn((entity: unknown) => {
    if (entity === GroupMembership) {
      return Promise.resolve(routing.memberships ?? []);
    }
    return Promise.resolve(routing.children ?? []);
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

  return {
    service: new GroupsService(em, groupPermissionService),
  };
}

describe('GroupsService', () => {
  describe('create', () => {
    it('creates a Root Group (no parentGroupId) and an OWNER membership', async () => {
      const { em, persist } = buildMockEm();
      const { service } = buildService(em);
      const user = buildUser();

      await service.create(user, buildCreateInput());

      const persistedEntities = persist.mock.calls[0][0] as unknown[];
      const persistedGroup = persistedEntities.find(
        (entity) => entity instanceof Group,
      ) as Group;
      const persistedMembership = persistedEntities.find(
        (entity) => entity instanceof GroupMembership,
      ) as GroupMembership;

      expect(persistedGroup.name).toBe('Capoeira Angola SP');
      expect(persistedGroup.parentGroup).toBeNull();
      expect(persistedMembership.role).toBe(GroupRole.OWNER);
      expect(persistedMembership.user).toBe(user);
      expect(persistedMembership.rootGroup).toBe(persistedGroup);
    });

    it('creates a Child Group when the caller has GROUP_EDIT in the parent', async () => {
      const parentMembership = buildMembership({ role: GroupRole.OWNER });
      const { em, persist } = buildMockEm({ parentMembership });
      const { service } = buildService(em);
      const user = buildUser();

      await service.create(
        user,
        buildCreateInput({ parentGroupId: 'parent-1' }),
      );

      const persistedGroup = (persist.mock.calls[0][0] as unknown[]).find(
        (entity) => entity instanceof Group,
      ) as Group;
      expect(persistedGroup.parentGroup).toBe(parentMembership.rootGroup);
    });

    it('rejects creating a Child Group when the caller has no active membership in the parent', async () => {
      const { em } = buildMockEm({ parentMembership: null });
      const { service } = buildService(em);

      await expect(
        service.create(
          buildUser(),
          buildCreateInput({ parentGroupId: 'parent-1' }),
        ),
      ).rejects.toMatchObject({ response: { code: 'GROUP_PARENT_NOT_FOUND' } });
    });

    it('rejects creating a Child Group when the caller lacks GROUP_EDIT in the parent', async () => {
      const parentMembership = buildMembership({ role: GroupRole.MEMBER });
      const { em } = buildMockEm({ parentMembership });
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
      const parentMembership = buildMembership({
        role: GroupRole.OWNER,
        rootGroup: buildGroup({ id: 'parent-1', status: GroupStatus.ARCHIVED }),
      });
      const { em } = buildMockEm({ parentMembership });
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
    it('maps each active membership to a summary with myRole set', async () => {
      const membership = new GroupMembership();
      membership.role = GroupRole.ADMIN;
      membership.rootGroup = buildGroup({ name: 'Grupo Axé' });
      const { em } = buildMockEm({ memberships: [membership] });
      const { service } = buildService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({ name: 'Grupo Axé', myRole: GroupRole.ADMIN }),
      ]);
    });

    it('includes groups with status ARCHIVED - archiving never touches membership', async () => {
      const membership = new GroupMembership();
      membership.role = GroupRole.OWNER;
      membership.rootGroup = buildGroup({
        name: 'Archived Group',
        status: GroupStatus.ARCHIVED,
      });
      const { em } = buildMockEm({ memberships: [membership] });
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
      const { em } = buildMockEm({ group: null });
      const { service } = buildService(em);

      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildGroup({ name: 'Old Name' });
      const { em } = buildMockEm({ group: existing });
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
      const { em } = buildMockEm({ group: existing });
      const { service } = buildService(em);

      await service.archive('group-1');

      expect(existing.status).toBe(GroupStatus.ARCHIVED);
    });

    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ group: null });
      const { service } = buildService(em);

      await expect(service.archive('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('unarchive', () => {
    it('sets status back to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.ARCHIVED });
      const { em } = buildMockEm({ group: existing });
      const { service } = buildService(em);

      await service.unarchive('group-1');

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });

  describe('setReadOnly', () => {
    it('sets status to READ_ONLY', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ group: existing });
      const { service } = buildService(em);

      await service.setReadOnly('group-1');

      expect(existing.status).toBe(GroupStatus.READ_ONLY);
    });
  });

  describe('activate', () => {
    it('sets status to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.READ_ONLY });
      const { em } = buildMockEm({ group: existing });
      const { service } = buildService(em);

      await service.activate('group-1');

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });
});
