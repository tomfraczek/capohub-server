import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole } from '../permissions/global-role.enum';
import { Permission } from '../permissions/permission.enum';
import { PermissionService } from '../permissions/permission.service';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  function buildContext(
    localUser: { globalRole: GlobalRole } | undefined,
  ): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({ localUser }),
      }),
    } as unknown as ExecutionContext;
  }

  function buildGuard(options: {
    requiredPermissions?: Permission[];
    hasAllPermissions?: jest.Mock;
  }): {
    guard: PermissionsGuard;
    getAllAndOverride: jest.Mock;
  } {
    const getAllAndOverride = jest
      .fn()
      .mockReturnValue(options.requiredPermissions);
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const permissionService = {
      hasAllPermissions:
        options.hasAllPermissions ?? jest.fn().mockReturnValue(true),
    } as unknown as PermissionService;

    return {
      guard: new PermissionsGuard(reflector, permissionService),
      getAllAndOverride,
    };
  }

  it('allows the request when no permissions metadata is set', () => {
    const { guard } = buildGuard({ requiredPermissions: undefined });

    expect(
      guard.canActivate(buildContext({ globalRole: GlobalRole.USER })),
    ).toBe(true);
  });

  it('allows the request when the required permissions list is empty', () => {
    const { guard } = buildGuard({ requiredPermissions: [] });

    expect(
      guard.canActivate(buildContext({ globalRole: GlobalRole.USER })),
    ).toBe(true);
  });

  it('allows the request when the user has all required permissions', () => {
    const hasAllPermissions = jest.fn().mockReturnValue(true);
    const { guard } = buildGuard({
      requiredPermissions: [Permission.USER_MANAGE],
      hasAllPermissions,
    });

    expect(
      guard.canActivate(buildContext({ globalRole: GlobalRole.ADMIN })),
    ).toBe(true);
    expect(hasAllPermissions).toHaveBeenCalledWith(GlobalRole.ADMIN, [
      Permission.USER_MANAGE,
    ]);
  });

  it('throws ForbiddenException when the user lacks a required permission', () => {
    const { guard } = buildGuard({
      requiredPermissions: [Permission.USER_MANAGE],
      hasAllPermissions: jest.fn().mockReturnValue(false),
    });

    expect(() =>
      guard.canActivate(buildContext({ globalRole: GlobalRole.USER })),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no local user on the request', () => {
    const { guard } = buildGuard({
      requiredPermissions: [Permission.USER_MANAGE],
    });

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('reads metadata from both handler and class', () => {
    const { guard, getAllAndOverride } = buildGuard({
      requiredPermissions: [],
    });

    guard.canActivate(buildContext({ globalRole: GlobalRole.USER }));

    expect(getAllAndOverride).toHaveBeenCalledWith(expect.any(String), [
      expect.anything(),
      expect.anything(),
    ]);
  });
});
