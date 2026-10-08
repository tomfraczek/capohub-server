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

  // Gated on ROLE_ASSIGNMENT_MANAGE/ROLE_ASSIGNMENT_VIEW - not GROUP_EDIT/
  // GROUP_VIEW (a Group ADMIN holds GROUP_EDIT but must not grant/revoke,
  // and GROUP_VIEW is public-view-safe), nor MEMBERSHIP_ROLE_CHANGE/
  // MEMBERSHIP_VIEW (those do not exist for a Group target at all - see
  // group-role-permissions.map.ts).
  describe.each<
    [
      keyof RoleAssignmentsController,
      GroupPermission[],
      GroupStatus[] | undefined,
    ]
  >([
    ['create', [GroupPermission.ROLE_ASSIGNMENT_MANAGE], undefined],
    ['list', [GroupPermission.ROLE_ASSIGNMENT_VIEW], undefined],
    ['getById', [GroupPermission.ROLE_ASSIGNMENT_VIEW], undefined],
    ['revoke', [GroupPermission.ROLE_ASSIGNMENT_MANAGE], undefined],
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
    it('delegates to RoleAssignmentsService.grantRole with a userId-based body for a Group route', async () => {
      const dto = { id: 'role-assignment-1' } as never;
      const grantRole = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ grantRole });
      const body = {
        userId: '22222222-2222-4222-8222-222222222222',
        role: 'ADMIN',
      };
      const user = { id: 'user-1' } as never;

      const response = await controller.create(
        'group-1',
        undefined as never,
        body,
        user,
      );

      expect(grantRole).toHaveBeenCalledWith('group-1', body, user);
      expect(response).toBe(dto);
    });

    it('delegates to RoleAssignmentsService.grantRole for a Section route, accepting a Section-only role', async () => {
      const dto = { id: 'role-assignment-1' } as never;
      const grantRole = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ grantRole });
      const body = {
        userId: '22222222-2222-4222-8222-222222222222',
        role: 'INSTRUCTOR',
      };
      const user = { id: 'user-1' } as never;

      const response = await controller.create(
        undefined as never,
        'section-1',
        body,
        user,
      );

      expect(grantRole).toHaveBeenCalledWith('section-1', body, user);
      expect(response).toBe(dto);
    });

    it('rejects a Section-only role (e.g. INSTRUCTOR) on a Group route with a validation error', async () => {
      const grantRole = jest.fn();
      const controller = buildController({ grantRole });
      const body = {
        userId: '22222222-2222-4222-8222-222222222222',
        role: 'INSTRUCTOR',
      };
      const user = { id: 'user-1' } as never;

      await expect(
        controller.create('group-1', undefined as never, body, user),
      ).rejects.toMatchObject({ response: { code: 'VALIDATION_ERROR' } });
      expect(grantRole).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('delegates to RoleAssignmentsService.listRoleAssignments', async () => {
      const dto = [{ id: 'role-assignment-1' }] as never;
      const listRoleAssignments = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ listRoleAssignments });

      const response = await controller.list('group-1', undefined as never);

      expect(listRoleAssignments).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to RoleAssignmentsService.getRoleAssignment', async () => {
      const dto = { id: 'role-assignment-1' } as never;
      const getRoleAssignment = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ getRoleAssignment });

      const response = await controller.getById(
        'group-1',
        undefined as never,
        'role-assignment-1',
      );

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

      await controller.revoke(
        'group-1',
        undefined as never,
        'role-assignment-1',
        user,
      );

      expect(revokeRole).toHaveBeenCalledWith(
        'group-1',
        'role-assignment-1',
        user,
      );
    });
  });
});
