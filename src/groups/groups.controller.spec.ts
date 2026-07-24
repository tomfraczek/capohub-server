import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ALLOW_GROUP_STATUSES_KEY } from './decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupMembershipsService } from './group-memberships.service';
import { GroupsController } from './groups.controller';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupsService } from './groups.service';

function buildController(
  groupsService: Partial<GroupsService> = {},
  groupMembershipsService: Partial<GroupMembershipsService> = {},
): GroupsController {
  return new GroupsController(
    groupsService as GroupsService,
    groupMembershipsService as GroupMembershipsService,
  );
}

describe('GroupsController', () => {
  it('is guarded by GroupPermissionsGuard at the class level', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(GUARDS_METADATA, GroupsController);

    expect(guards).toEqual([GroupPermissionsGuard]);
  });

  const ANY_STATUS = [
    GroupStatus.ACTIVE,
    GroupStatus.READ_ONLY,
    GroupStatus.ARCHIVED,
    GroupStatus.DELETED,
  ];

  describe.each<
    [keyof GroupsController, GroupPermission[], GroupStatus[] | undefined]
  >([
    ['getById', [GroupPermission.GROUP_VIEW], ANY_STATUS],
    ['update', [GroupPermission.GROUP_EDIT], undefined],
    ['listChildren', [GroupPermission.GROUP_VIEW], ANY_STATUS],
    [
      'archive',
      [GroupPermission.GROUP_ARCHIVE],
      [GroupStatus.ACTIVE, GroupStatus.READ_ONLY],
    ],
    ['unarchive', [GroupPermission.GROUP_UNARCHIVE], [GroupStatus.ARCHIVED]],
    [
      'setReadOnly',
      [GroupPermission.GROUP_SET_READ_ONLY],
      [GroupStatus.ACTIVE],
    ],
    ['activate', [GroupPermission.GROUP_ACTIVATE], [GroupStatus.READ_ONLY]],
    [
      'delete',
      [GroupPermission.GROUP_DELETE],
      [GroupStatus.ACTIVE, GroupStatus.READ_ONLY, GroupStatus.ARCHIVED],
    ],
    [
      'transferOwnership',
      [GroupPermission.GROUP_OWNERSHIP_TRANSFER],
      undefined,
    ],
    ['leave', [GroupPermission.GROUP_VIEW], undefined],
    ['listMembers', [GroupPermission.GROUP_VIEW], ANY_STATUS],
    ['addMember', [GroupPermission.MEMBERSHIP_ADD], undefined],
    ['getMembership', [GroupPermission.GROUP_VIEW], ANY_STATUS],
    ['removeMember', [GroupPermission.MEMBERSHIP_REMOVE], undefined],
    ['banMember', [GroupPermission.MEMBERSHIP_BAN], undefined],
    ['unbanMember', [GroupPermission.MEMBERSHIP_UNBAN], undefined],
    ['suspendMember', [GroupPermission.MEMBERSHIP_SUSPEND], undefined],
    ['unsuspendMember', [GroupPermission.MEMBERSHIP_UNSUSPEND], undefined],
    ['assignSection', [GroupPermission.MEMBERSHIP_SECTION_ASSIGN], undefined],
    ['unassignSection', [GroupPermission.MEMBERSHIP_SECTION_ASSIGN], undefined],
  ])('%s', (method, expectedPermissions, expectedAllowedStatuses) => {
    it(`requires ${expectedPermissions.join(', ')}`, () => {
      const reflector = new Reflector();

      const handlerRef = GroupsController.prototype[method];
      const metadata = reflector.get<GroupPermission[]>(
        GROUP_PERMISSIONS_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedPermissions);
    });

    it(`sets @AllowGroupStatuses(...) to ${JSON.stringify(expectedAllowedStatuses)}`, () => {
      const reflector = new Reflector();

      const handlerRef = GroupsController.prototype[method];
      const metadata = reflector.get<GroupStatus[] | undefined>(
        ALLOW_GROUP_STATUSES_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedAllowedStatuses);
    });
  });

  describe('create', () => {
    it('delegates to GroupsService.create with the current user and body', async () => {
      const dto = { id: 'group-1' } as never;
      const create = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ create });
      const user = { id: 'user-1' } as never;
      const body = { name: 'Grupo' } as never;

      const response = await controller.create(user, body);

      expect(create).toHaveBeenCalledWith(user, body);
      expect(response).toBe(dto);
    });
  });

  describe('listMine', () => {
    it('delegates to GroupsService.listMine with the current user id', async () => {
      const dto = [{ id: 'group-1' }] as never;
      const listMine = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ listMine });

      const response = await controller.listMine({ id: 'user-1' } as never);

      expect(listMine).toHaveBeenCalledWith('user-1');
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to GroupsService.getById', async () => {
      const dto = { id: 'group-1' } as never;
      const getById = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ getById });

      const response = await controller.getById('group-1');

      expect(getById).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to GroupsService.update', async () => {
      const dto = { id: 'group-1' } as never;
      const update = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ update });
      const body = { name: 'New name' } as never;
      const user = { id: 'user-1' } as never;

      const response = await controller.update('group-1', body, user);

      expect(update).toHaveBeenCalledWith('group-1', body, user);
      expect(response).toBe(dto);
    });
  });

  describe('archive', () => {
    it('delegates to GroupsService.archive', async () => {
      const dto = { id: 'group-1' } as never;
      const archive = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ archive });
      const user = { id: 'user-1' } as never;

      const response = await controller.archive('group-1', user);

      expect(archive).toHaveBeenCalledWith('group-1', user);
      expect(response).toBe(dto);
    });
  });

  describe('unarchive', () => {
    it('delegates to GroupsService.unarchive', async () => {
      const dto = { id: 'group-1' } as never;
      const unarchive = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ unarchive });
      const user = { id: 'user-1' } as never;

      const response = await controller.unarchive('group-1', user);

      expect(unarchive).toHaveBeenCalledWith('group-1', user);
      expect(response).toBe(dto);
    });
  });

  describe('setReadOnly', () => {
    it('delegates to GroupsService.setReadOnly', async () => {
      const dto = { id: 'group-1' } as never;
      const setReadOnly = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ setReadOnly });
      const user = { id: 'user-1' } as never;

      const response = await controller.setReadOnly('group-1', user);

      expect(setReadOnly).toHaveBeenCalledWith('group-1', user);
      expect(response).toBe(dto);
    });
  });

  describe('activate', () => {
    it('delegates to GroupsService.activate', async () => {
      const dto = { id: 'group-1' } as never;
      const activate = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ activate });
      const user = { id: 'user-1' } as never;

      const response = await controller.activate('group-1', user);

      expect(activate).toHaveBeenCalledWith('group-1', user);
      expect(response).toBe(dto);
    });
  });

  describe('delete', () => {
    it('delegates to GroupsService.delete', async () => {
      const dto = { id: 'group-1' } as never;
      const deleteFn = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ delete: deleteFn });
      const user = { id: 'user-1' } as never;

      const response = await controller.delete('group-1', user);

      expect(deleteFn).toHaveBeenCalledWith('group-1', user);
      expect(response).toBe(dto);
    });
  });

  describe('listChildren', () => {
    it('delegates to GroupsService.listChildren', async () => {
      const dto = [{ id: 'child-1' }] as never;
      const listChildren = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ listChildren });

      const response = await controller.listChildren('group-1');

      expect(listChildren).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('transferOwnership', () => {
    it('delegates to GroupMembershipsService.transferOwnership', async () => {
      const dto = { newOwner: {} } as never;
      const transferOwnership = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { transferOwnership });
      const body = { newOwnerUserId: 'user-2' } as never;
      const user = { id: 'user-1' } as never;

      const response = await controller.transferOwnership(
        'group-1',
        user,
        body,
      );

      expect(transferOwnership).toHaveBeenCalledWith(
        'group-1',
        'user-1',
        body,
        user,
      );
      expect(response).toBe(dto);
    });
  });

  describe('leave', () => {
    it('delegates to GroupMembershipsService.leave', async () => {
      const leave = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { leave });
      const user = { id: 'user-1' } as never;

      await controller.leave('group-1', user);

      expect(leave).toHaveBeenCalledWith('group-1', user);
    });
  });

  describe('listMembers', () => {
    it('delegates to GroupMembershipsService.listMembers', async () => {
      const dto = [{ id: 'membership-1' }] as never;
      const listMembers = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { listMembers });

      const response = await controller.listMembers('group-1');

      expect(listMembers).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('addMember', () => {
    it('delegates to GroupMembershipsService.addMember', async () => {
      const dto = { id: 'membership-1' } as never;
      const addMember = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { addMember });
      const body = { userId: 'user-2' } as never;

      const response = await controller.addMember('group-1', body);

      expect(addMember).toHaveBeenCalledWith('group-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('getMembership', () => {
    it('delegates to GroupMembershipsService.getMembership', async () => {
      const dto = { id: 'membership-1' } as never;
      const getMembership = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { getMembership });

      const response = await controller.getMembership(
        'group-1',
        'membership-1',
      );

      expect(getMembership).toHaveBeenCalledWith('group-1', 'membership-1');
      expect(response).toBe(dto);
    });
  });

  describe('removeMember', () => {
    it('delegates to GroupMembershipsService.removeMember', async () => {
      const removeMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { removeMember });
      const user = { id: 'user-1' } as never;

      await controller.removeMember('group-1', 'membership-1', user);

      expect(removeMember).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        user,
      );
    });
  });

  describe('banMember', () => {
    it('delegates to GroupMembershipsService.banMember', async () => {
      const banMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { banMember });
      const user = { id: 'user-1' } as never;
      const body = { reason: 'Repeated rule violations' } as never;

      await controller.banMember('group-1', 'membership-1', body, user);

      expect(banMember).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        user,
        'Repeated rule violations',
      );
    });

    it('passes null when no reason is given', async () => {
      const banMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { banMember });
      const user = { id: 'user-1' } as never;

      await controller.banMember('group-1', 'membership-1', {}, user);

      expect(banMember).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        user,
        null,
      );
    });
  });

  describe('unbanMember', () => {
    it('delegates to GroupMembershipsService.unbanMember', async () => {
      const unbanMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { unbanMember });
      const user = { id: 'user-1' } as never;

      await controller.unbanMember('group-1', 'membership-1', user);

      expect(unbanMember).toHaveBeenCalledWith('group-1', 'membership-1', user);
    });
  });

  describe('suspendMember', () => {
    it('delegates to GroupMembershipsService.suspendMember, converting until to a Date', async () => {
      const dto = { id: 'membership-1' } as never;
      const suspendMember = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { suspendMember });
      const user = { id: 'user-1' } as never;
      const until = '2026-08-01T00:00:00.000Z';

      const response = await controller.suspendMember(
        'group-1',
        'membership-1',
        { until, reason: 'Cooldown' },
        user,
      );

      expect(suspendMember).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        user,
        new Date(until),
        'Cooldown',
      );
      expect(response).toBe(dto);
    });

    it('passes null for until/reason when omitted', async () => {
      const suspendMember = jest.fn().mockResolvedValue({});
      const controller = buildController({}, { suspendMember });
      const user = { id: 'user-1' } as never;

      await controller.suspendMember('group-1', 'membership-1', {}, user);

      expect(suspendMember).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        user,
        null,
        null,
      );
    });
  });

  describe('unsuspendMember', () => {
    it('delegates to GroupMembershipsService.unsuspendMember', async () => {
      const dto = { id: 'membership-1' } as never;
      const unsuspendMember = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { unsuspendMember });
      const user = { id: 'user-1' } as never;

      const response = await controller.unsuspendMember(
        'group-1',
        'membership-1',
        user,
      );

      expect(unsuspendMember).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        user,
      );
      expect(response).toBe(dto);
    });
  });

  describe('assignSection', () => {
    it('delegates to GroupMembershipsService.assignSection', async () => {
      const assignSection = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { assignSection });

      await controller.assignSection('group-1', 'membership-1', 'section-1');

      expect(assignSection).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        'section-1',
      );
    });
  });

  describe('unassignSection', () => {
    it('delegates to GroupMembershipsService.unassignSection', async () => {
      const unassignSection = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { unassignSection });

      await controller.unassignSection('group-1', 'membership-1', 'section-1');

      expect(unassignSection).toHaveBeenCalledWith(
        'group-1',
        'membership-1',
        'section-1',
      );
    });
  });
});
