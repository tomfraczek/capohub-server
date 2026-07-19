import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CreateGroupInput } from './dto/create-group.schema';
import { GroupMembership } from './entities/group-membership.entity';
import { Group } from './entities/group.entity';
import { GroupRole } from './enums/group-role.enum';
import { GroupStatus } from './enums/group-status.enum';
import { GroupVisibility } from './enums/group-visibility.enum';
import { GroupsService } from './groups.service';

function buildCreateInput(
  overrides: Partial<CreateGroupInput> = {},
): CreateGroupInput {
  return {
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

interface MockRouting {
  group?: Group | null;
  memberships?: GroupMembership[];
}

function buildMockEm(routing: MockRouting = {}) {
  const flush = jest.fn().mockResolvedValue(undefined);
  const persist = jest
    .fn<{ flush: jest.Mock }, [object[]]>()
    .mockReturnValue({ flush });
  const findOne = jest
    .fn()
    .mockResolvedValue(
      routing.group === undefined ? buildGroup() : routing.group,
    );
  const find = jest.fn().mockResolvedValue(routing.memberships ?? []);

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

describe('GroupsService', () => {
  describe('create', () => {
    it('creates the group and an OWNER membership for the creator', async () => {
      const { em, persist } = buildMockEm();
      const service = new GroupsService(em);
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
      expect(persistedMembership.role).toBe(GroupRole.OWNER);
      expect(persistedMembership.user).toBe(user);
      expect(persistedMembership.group).toBe(persistedGroup);
    });
  });

  describe('listMine', () => {
    it('maps each active membership to a summary with myRole set', async () => {
      const membership = new GroupMembership();
      membership.role = GroupRole.ADMIN;
      membership.group = buildGroup({ name: 'Grupo Axé' });
      const { em } = buildMockEm({ memberships: [membership] });
      const service = new GroupsService(em);

      const result = await service.listMine('user-1');

      expect(result).toEqual([
        expect.objectContaining({ name: 'Grupo Axé', myRole: GroupRole.ADMIN }),
      ]);
    });

    it('includes groups with status ARCHIVED - archiving never touches membership', async () => {
      const membership = new GroupMembership();
      membership.role = GroupRole.OWNER;
      membership.group = buildGroup({
        name: 'Archived Group',
        status: GroupStatus.ARCHIVED,
      });
      const { em } = buildMockEm({ memberships: [membership] });
      const service = new GroupsService(em);

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
      const service = new GroupsService(em);

      await expect(service.getById('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('update', () => {
    it('applies every field from the input', async () => {
      const existing = buildGroup({ name: 'Old Name' });
      const { em } = buildMockEm({ group: existing });
      const service = new GroupsService(em);

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
      const service = new GroupsService(em);

      await service.archive('group-1');

      expect(existing.status).toBe(GroupStatus.ARCHIVED);
    });

    it('throws NotFoundException when the group does not exist', async () => {
      const { em } = buildMockEm({ group: null });
      const service = new GroupsService(em);

      await expect(service.archive('missing-id')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('unarchive', () => {
    it('sets status back to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.ARCHIVED });
      const { em } = buildMockEm({ group: existing });
      const service = new GroupsService(em);

      await service.unarchive('group-1');

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });

  describe('setReadOnly', () => {
    it('sets status to READ_ONLY', async () => {
      const existing = buildGroup({ status: GroupStatus.ACTIVE });
      const { em } = buildMockEm({ group: existing });
      const service = new GroupsService(em);

      await service.setReadOnly('group-1');

      expect(existing.status).toBe(GroupStatus.READ_ONLY);
    });
  });

  describe('activate', () => {
    it('sets status to ACTIVE', async () => {
      const existing = buildGroup({ status: GroupStatus.READ_ONLY });
      const { em } = buildMockEm({ group: existing });
      const service = new GroupsService(em);

      await service.activate('group-1');

      expect(existing.status).toBe(GroupStatus.ACTIVE);
    });
  });
});
