import { NotFoundException } from '@nestjs/common';
import type { EntityManager } from '@mikro-orm/postgresql';
import { User } from '../users/entities/user.entity';
import { CommunityNotificationSettingsService } from './community-notification-settings.service';
import { CommunityNotificationSettings } from './entities/community-notification-settings.entity';
import { Group } from './entities/group.entity';
import { RoleAssignment } from './entities/role-assignment.entity';
import { Section } from './entities/section.entity';
import { SectionMembership } from './entities/section-membership.entity';
import { SectionMembershipStatus } from './enums/section-membership-status.enum';

function buildSection(overrides: Partial<Section> = {}): Section {
  const section = new Section();
  section.id = 'section-1';
  section.name = 'Cordão de Ouro Poznan';
  return Object.assign(section, overrides);
}

function buildGroup(overrides: Partial<Group> = {}): Group {
  const group = new Group();
  group.id = 'group-1';
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
  overrides: Partial<SectionMembership> = {},
): SectionMembership {
  const membership = new SectionMembership();
  membership.id = 'membership-1';
  membership.status = SectionMembershipStatus.ACTIVE;
  return Object.assign(membership, overrides);
}

function buildSettings(
  overrides: Partial<CommunityNotificationSettings> = {},
): CommunityNotificationSettings {
  const settings = new CommunityNotificationSettings();
  settings.communitySection = buildSection();
  settings.user = buildUser();
  return Object.assign(settings, overrides);
}

interface MockRouting {
  section?: Section | null;
  membership?: SectionMembership | null;
  settings?: CommunityNotificationSettings | null;
  group?: Group | null;
  roleCount?: number;
}

function buildMockEm(routing: MockRouting = {}) {
  const persist = jest.fn<void, [CommunityNotificationSettings]>();
  const flush = jest.fn().mockResolvedValue(undefined);

  const findOne = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === Section) {
      return Promise.resolve(
        routing.section === undefined ? buildSection() : routing.section,
      );
    }
    if (entity === Group) {
      return Promise.resolve(
        routing.group === undefined ? buildGroup() : routing.group,
      );
    }
    if (entity === SectionMembership) {
      return Promise.resolve(routing.membership ?? null);
    }
    if (entity === CommunityNotificationSettings) {
      return Promise.resolve(routing.settings ?? null);
    }
    return Promise.resolve(null);
  });

  const count = jest.fn().mockImplementation((entity: unknown) => {
    if (entity === RoleAssignment) {
      return Promise.resolve(routing.roleCount ?? 0);
    }
    return Promise.resolve(0);
  });

  const em = {
    findOne,
    count,
    persist,
    flush,
    transactional: jest
      .fn()
      .mockImplementation((cb: (em: unknown) => unknown) => cb(em)),
  } as unknown as EntityManager;

  return { em, findOne, count, persist, flush };
}

describe('CommunityNotificationSettingsService', () => {
  describe('get', () => {
    it('returns every default as true when no settings row exists yet', async () => {
      const { em } = buildMockEm({ membership: buildMembership() });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.get('section-1', buildUser());

      expect(result).toEqual({
        communityId: 'section-1',
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
        muted: false,
      });
    });

    it('returns the stored values when a settings row exists', async () => {
      const settings = buildSettings({
        newJoinRequests: false,
        roleChanges: false,
      });
      const { em } = buildMockEm({ membership: buildMembership(), settings });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.get('section-1', buildUser());

      expect(result.newJoinRequests).toBe(false);
      expect(result.roleChanges).toBe(false);
      expect(result.newInvitations).toBe(true);
    });

    it('throws 404 SECTION_NOT_FOUND when the caller has no ACTIVE membership, never revealing the section exists', async () => {
      const { em } = buildMockEm({ membership: null });
      const service = new CommunityNotificationSettingsService(em);

      await expect(service.get('section-1', buildUser())).rejects.toThrow(
        NotFoundException,
      );
      await expect(service.get('section-1', buildUser())).rejects.toMatchObject(
        {
          response: { code: 'SECTION_NOT_FOUND' },
        },
      );
    });

    it('rejects with SECTION_NOT_FOUND when the id does not resolve to a Section at all - Group has no notification settings', async () => {
      const { em, findOne } = buildMockEm({ section: null });
      const service = new CommunityNotificationSettingsService(em);

      await expect(service.get('group-1', buildUser())).rejects.toMatchObject({
        response: { code: 'SECTION_NOT_FOUND' },
      });

      expect(findOne).not.toHaveBeenCalledWith(
        CommunityNotificationSettings,
        expect.anything(),
      );
    });
  });

  describe('update', () => {
    it('creates a new settings row lazily on first update', async () => {
      const user = buildUser();
      const { em, persist, flush } = buildMockEm({
        membership: buildMembership(),
        settings: null,
      });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.update('section-1', user, {
        newJoinRequests: false,
      });

      expect(persist).toHaveBeenCalledTimes(1);
      const persisted = persist.mock.calls[0][0];
      expect(persisted.communitySection?.id).toBe('section-1');
      expect(persisted.user).toBe(user);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(result.newJoinRequests).toBe(false);
    });

    it('applies a partial patch, leaving every other field at its current value', async () => {
      const existing = buildSettings({
        newJoinRequests: false,
        roleChanges: false,
        archived: false,
      });
      const { em, persist } = buildMockEm({
        membership: buildMembership(),
        settings: existing,
      });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.update('section-1', buildUser(), {
        roleChanges: true,
      });

      expect(persist).not.toHaveBeenCalled();
      expect(result.newJoinRequests).toBe(false);
      expect(result.roleChanges).toBe(true);
      expect(result.archived).toBe(false);
    });

    it('throws 404 SECTION_NOT_FOUND when the caller has no ACTIVE membership', async () => {
      const { em } = buildMockEm({ membership: null });
      const service = new CommunityNotificationSettingsService(em);

      await expect(
        service.update('section-1', buildUser(), { newJoinRequests: false }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getForGroup', () => {
    it('defaults muted=false when no settings row exists yet - the minimal {communityId, muted} shape only', async () => {
      const { em } = buildMockEm({ roleCount: 1 });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.getForGroup('group-1', buildUser());

      expect(result).toEqual({ communityId: 'group-1', muted: false });
    });

    it('returns the stored muted value', async () => {
      const settings = buildSettings({
        communitySection: null,
        communityGroup: buildGroup(),
        muted: true,
      });
      const { em } = buildMockEm({ roleCount: 1, settings });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.getForGroup('group-1', buildUser());

      expect(result.muted).toBe(true);
    });

    it('throws 404 GROUP_NOT_FOUND when the caller holds no active RoleAssignment, never revealing the group exists', async () => {
      const { em } = buildMockEm({ roleCount: 0 });
      const service = new CommunityNotificationSettingsService(em);

      await expect(
        service.getForGroup('group-1', buildUser()),
      ).rejects.toMatchObject({ response: { code: 'GROUP_NOT_FOUND' } });
    });

    it('throws 404 GROUP_NOT_FOUND when the id does not resolve to a Group at all', async () => {
      const { em, count } = buildMockEm({ group: null });
      const service = new CommunityNotificationSettingsService(em);

      await expect(
        service.getForGroup('section-1', buildUser()),
      ).rejects.toMatchObject({ response: { code: 'GROUP_NOT_FOUND' } });
      expect(count).not.toHaveBeenCalled();
    });
  });

  describe('updateForGroup', () => {
    it('creates a new Group-scoped settings row lazily on first update', async () => {
      const user = buildUser();
      const { em, persist, flush } = buildMockEm({
        roleCount: 1,
        settings: null,
      });
      const service = new CommunityNotificationSettingsService(em);

      const result = await service.updateForGroup('group-1', user, {
        muted: true,
      });

      expect(persist).toHaveBeenCalledTimes(1);
      const persisted = persist.mock.calls[0][0];
      expect(persisted.communityGroup?.id).toBe('group-1');
      expect(persisted.communitySection).toBeNull();
      expect(persisted.user).toBe(user);
      expect(flush).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ communityId: 'group-1', muted: true });
    });

    it('throws 404 GROUP_NOT_FOUND when the caller holds no active RoleAssignment', async () => {
      const { em } = buildMockEm({ roleCount: 0 });
      const service = new CommunityNotificationSettingsService(em);

      await expect(
        service.updateForGroup('group-1', buildUser(), { muted: true }),
      ).rejects.toThrow(NotFoundException);
    });
  });
});
