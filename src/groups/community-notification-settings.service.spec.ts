import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityNotificationSettingsService } from './community-notification-settings.service';
import { CommunityNotificationSettings } from './entities/community-notification-settings.entity';
import { Group } from './entities/group.entity';
import { GroupMembership } from './entities/group-membership.entity';
import { GroupMembershipStatus } from './enums/group-membership-status.enum';
import { GroupHierarchyService } from './group-hierarchy.service';

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'root-1';
  group.name = 'Cordão de Ouro';
  return Object.assign(group, overrides);
}

function buildUser(overrides: Partial<User> = {}): User {
  const user = new User();
  user.id = 'user-1';
  user.displayName = 'Ana Silva';
  return Object.assign(user, overrides);
}

function buildMembership(
  overrides: Partial<GroupMembership> = {},
): GroupMembership {
  const membership = new GroupMembership();
  membership.id = 'membership-1';
  membership.status = GroupMembershipStatus.ACTIVE;
  return Object.assign(membership, overrides);
}

function buildSettings(
  overrides: Partial<CommunityNotificationSettings> = {},
): CommunityNotificationSettings {
  const settings = new CommunityNotificationSettings();
  settings.community = buildGroup();
  settings.user = buildUser();
  return Object.assign(settings, overrides);
}

interface MockRouting {
  membership?: GroupMembership | null;
  settings?: CommunityNotificationSettings | null;
}

function buildMockEm(routing: MockRouting = {}) {
  const persist = jest.fn<void, [CommunityNotificationSettings]>();
  const flush = jest.fn().mockResolvedValue(undefined);

  const findOne = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === GroupMembership) {
      return Promise.resolve(routing.membership ?? null);
    }
    if (entity === CommunityNotificationSettings) {
      return Promise.resolve(routing.settings ?? null);
    }
    return Promise.resolve(null);
  });

  const em = {
    findOne,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: unknown) => unknown) => cb(em)),
  } as unknown as EntityManager;

  return { em, findOne, persist, flush };
}

function buildGroupHierarchyService(rootGroup: Group) {
  const getRootGroup = jest.fn().mockResolvedValue(rootGroup);
  const groupHierarchyService = {
    getRootGroup,
  } as unknown as GroupHierarchyService;
  return { groupHierarchyService, getRootGroup };
}

describe('CommunityNotificationSettingsService', () => {
  describe('get', () => {
    it('returns every default as true when no settings row exists yet', async () => {
      const rootGroup = buildGroup();
      const { em } = buildMockEm({ membership: buildMembership() });
      const service = new CommunityNotificationSettingsService(
        em,
        buildGroupHierarchyService(rootGroup).groupHierarchyService,
      );

      const result = await service.get('root-1', buildUser());

      expect(result).toEqual({
        communityId: 'root-1',
        newJoinRequests: true,
        joinRequestApproved: true,
        newInvitations: true,
        invitationAccepted: true,
        invitationRejected: true,
        roleChanges: true,
        transferOwnership: true,
        archived: true,
        restored: true,
        communityDeleted: true,
      });
    });

    it('returns the stored values when a settings row exists', async () => {
      const rootGroup = buildGroup();
      const settings = buildSettings({
        newJoinRequests: false,
        roleChanges: false,
      });
      const { em } = buildMockEm({ membership: buildMembership(), settings });
      const service = new CommunityNotificationSettingsService(
        em,
        buildGroupHierarchyService(rootGroup).groupHierarchyService,
      );

      const result = await service.get('root-1', buildUser());

      expect(result.newJoinRequests).toBe(false);
      expect(result.roleChanges).toBe(false);
      expect(result.newInvitations).toBe(true);
    });

    it('throws 404 GROUP_NOT_FOUND when the caller has no ACTIVE membership, never revealing the group exists', async () => {
      const rootGroup = buildGroup();
      const { em } = buildMockEm({ membership: null });
      const service = new CommunityNotificationSettingsService(
        em,
        buildGroupHierarchyService(rootGroup).groupHierarchyService,
      );

      await expect(service.get('root-1', buildUser())).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.get('root-1', buildUser())).rejects.toMatchObject({
        response: { code: 'GROUP_NOT_FOUND' },
      });
    });

    it('resolves settings against the Root Group even when a Child Group id is passed', async () => {
      const rootGroup = buildGroup({ id: 'root-1' });
      const { em, findOne } = buildMockEm({ membership: buildMembership() });
      const { groupHierarchyService, getRootGroup } =
        buildGroupHierarchyService(rootGroup);
      const service = new CommunityNotificationSettingsService(
        em,
        groupHierarchyService,
      );

      await service.get('child-1', buildUser());

      expect(getRootGroup).toHaveBeenCalledWith('child-1', em);
      expect(findOne).toHaveBeenCalledWith(
        CommunityNotificationSettings,
        expect.objectContaining({ community: 'root-1' }),
      );
    });
  });

  describe('update', () => {
    it('creates a new settings row lazily on first update', async () => {
      const rootGroup = buildGroup();
      const user = buildUser();
      const { em, persist, flush } = buildMockEm({
        membership: buildMembership(),
        settings: null,
      });
      const service = new CommunityNotificationSettingsService(
        em,
        buildGroupHierarchyService(rootGroup).groupHierarchyService,
      );

      const result = await service.update('root-1', user, {
        newJoinRequests: false,
      });

      expect(persist).toHaveBeenCalledTimes(1);
      const persisted = persist.mock.calls[0][0];
      expect(persisted.community).toBe(rootGroup);
      expect(persisted.user).toBe(user);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(result.newJoinRequests).toBe(false);
    });

    it('applies a partial patch, leaving every other field at its current value', async () => {
      const rootGroup = buildGroup();
      const existing = buildSettings({
        newJoinRequests: false,
        roleChanges: false,
        archived: false,
      });
      const { em, persist } = buildMockEm({
        membership: buildMembership(),
        settings: existing,
      });
      const service = new CommunityNotificationSettingsService(
        em,
        buildGroupHierarchyService(rootGroup).groupHierarchyService,
      );

      const result = await service.update('root-1', buildUser(), {
        roleChanges: true,
      });

      expect(persist).not.toHaveBeenCalled();
      expect(result.newJoinRequests).toBe(false);
      expect(result.roleChanges).toBe(true);
      expect(result.archived).toBe(false);
    });

    it('throws 404 GROUP_NOT_FOUND when the caller has no ACTIVE membership', async () => {
      const rootGroup = buildGroup();
      const { em } = buildMockEm({ membership: null });
      const service = new CommunityNotificationSettingsService(
        em,
        buildGroupHierarchyService(rootGroup).groupHierarchyService,
      );

      await expect(
        service.update('root-1', buildUser(), { newJoinRequests: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
