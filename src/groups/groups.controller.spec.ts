import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ALLOW_GROUP_STATUSES_KEY } from './decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupsController } from './groups.controller';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { HierarchyManagementService } from './hierarchy-management.service';
import { GroupPermission } from './permissions/group-permission.enum';
import { GroupsService } from './groups.service';
import { RoleAssignmentsService } from './role-assignments.service';

// Group has no ordinary members at all - every join/leave/member-list/ban/
// suspend/cohort route that used to live here moved to SectionController
// (see section.controller.spec.ts). This controller only ever manages the
// Group entity itself and its OWNER/ADMIN RoleAssignments (transferOwnership).

function buildController(
  groupsService: Partial<GroupsService> = {},
  roleAssignmentsService: Partial<RoleAssignmentsService> = {},
  hierarchyManagementService: Partial<HierarchyManagementService> = {},
): GroupsController {
  return new GroupsController(
    groupsService as GroupsService,
    roleAssignmentsService as RoleAssignmentsService,
    hierarchyManagementService as HierarchyManagementService,
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

  it('has no member-management routes at all - Group has no ordinary members', () => {
    const memberRouteNames = [
      'leave',
      'listMembers',
      'addMember',
      'getMembership',
      'removeMember',
      'banMember',
      'unbanMember',
      'suspendMember',
      'unsuspendMember',
      'assignCohort',
      'unassignCohort',
    ];
    for (const name of memberRouteNames) {
      expect(
        (GroupsController.prototype as unknown as Record<string, unknown>)[
          name
        ],
      ).toBeUndefined();
    }
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

  describe('transferOwnership', () => {
    it('delegates to RoleAssignmentsService.transferOwnership with newOwnerUserId unwrapped from the body', async () => {
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
        'user-2',
        user,
      );
      expect(response).toBe(dto);
    });
  });
});
