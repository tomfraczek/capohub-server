import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ALLOW_GROUP_STATUSES_KEY } from './decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { RoleAssignmentsController } from './role-assignments.controller';
import { RoleAssignmentsService } from './role-assignments.service';

function buildController(
  roleAssignmentsService: Partial<RoleAssignmentsService> = {},
): RoleAssignmentsController {
  return new RoleAssignmentsController(
    roleAssignmentsService as RoleAssignmentsService,
  );
}

describe('RoleAssignmentsController', () => {
  it('is guarded by GroupPermissionsGuard at the class level', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(
      GUARDS_METADATA,
      RoleAssignmentsController,
    );

    expect(guards).toEqual([GroupPermissionsGuard]);
  });

  describe.each<
    [
      keyof RoleAssignmentsController,
      GroupPermission[],
      GroupStatus[] | undefined,
    ]
  >([
    ['create', [GroupPermission.MEMBERSHIP_ROLE_CHANGE], undefined],
    ['list', [GroupPermission.MEMBERSHIP_VIEW], undefined],
    ['getById', [GroupPermission.MEMBERSHIP_VIEW], undefined],
    ['revoke', [GroupPermission.MEMBERSHIP_ROLE_CHANGE], undefined],
  ])('%s', (method, expectedPermissions, expectedAllowedStatuses) => {
    it(`requires ${expectedPermissions.join(', ')}`, () => {
      const reflector = new Reflector();

      const handlerRef = RoleAssignmentsController.prototype[method];
      const metadata = reflector.get<GroupPermission[]>(
        GROUP_PERMISSIONS_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedPermissions);
    });

    it(`sets @AllowGroupStatuses(...) to ${JSON.stringify(expectedAllowedStatuses)}`, () => {
      const reflector = new Reflector();

      const handlerRef = RoleAssignmentsController.prototype[method];
      const metadata = reflector.get<GroupStatus[] | undefined>(
        ALLOW_GROUP_STATUSES_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedAllowedStatuses);
    });
  });

  describe('create', () => {
    it('delegates to RoleAssignmentsService.grantRole', async () => {
      const dto = { id: 'role-assignment-1' } as never;
      const grantRole = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ grantRole });
      const body = { membershipId: 'membership-1', role: 'ADMIN' } as never;
      const user = { id: 'user-1' } as never;

      const response = await controller.create('group-1', body, user);

      expect(grantRole).toHaveBeenCalledWith('group-1', body, user);
      expect(response).toBe(dto);
    });
  });

  describe('list', () => {
    it('delegates to RoleAssignmentsService.listRoleAssignments', async () => {
      const dto = [{ id: 'role-assignment-1' }] as never;
      const listRoleAssignments = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ listRoleAssignments });

      const response = await controller.list('group-1');

      expect(listRoleAssignments).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to RoleAssignmentsService.getRoleAssignment', async () => {
      const dto = { id: 'role-assignment-1' } as never;
      const getRoleAssignment = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ getRoleAssignment });

      const response = await controller.getById('group-1', 'role-assignment-1');

      expect(getRoleAssignment).toHaveBeenCalledWith(
        'group-1',
        'role-assignment-1',
      );
      expect(response).toBe(dto);
    });
  });

  describe('revoke', () => {
    it('delegates to RoleAssignmentsService.revokeRole', async () => {
      const revokeRole = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({ revokeRole });
      const user = { id: 'user-1' } as never;

      await controller.revoke('group-1', 'role-assignment-1', user);

      expect(revokeRole).toHaveBeenCalledWith(
        'group-1',
        'role-assignment-1',
        user,
      );
    });
  });
});
