import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GlobalRole } from '../permissions/global-role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
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

  function buildGuard(requiredRoles: GlobalRole[] | undefined): {
    guard: RolesGuard;
    getAllAndOverride: jest.Mock;
  } {
    const getAllAndOverride = jest.fn().mockReturnValue(requiredRoles);
    const reflector = { getAllAndOverride } as unknown as Reflector;

    return { guard: new RolesGuard(reflector), getAllAndOverride };
  }

  it('allows the request when no roles metadata is set', () => {
    const { guard } = buildGuard(undefined);

    expect(
      guard.canActivate(buildContext({ globalRole: GlobalRole.USER })),
    ).toBe(true);
  });

  it('allows the request when the required roles list is empty', () => {
    const { guard } = buildGuard([]);

    expect(
      guard.canActivate(buildContext({ globalRole: GlobalRole.USER })),
    ).toBe(true);
  });

  it('allows the request when the user has one of the required roles', () => {
    const { guard } = buildGuard([GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN]);

    expect(
      guard.canActivate(buildContext({ globalRole: GlobalRole.ADMIN })),
    ).toBe(true);
  });

  it('throws ForbiddenException when the user role is not in the allowed list', () => {
    const { guard } = buildGuard([GlobalRole.ADMIN]);

    expect(() =>
      guard.canActivate(buildContext({ globalRole: GlobalRole.USER })),
    ).toThrow(ForbiddenException);
  });

  it('throws ForbiddenException when there is no local user on the request', () => {
    const { guard } = buildGuard([GlobalRole.ADMIN]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('checks membership only, not hierarchy (a higher role must be listed explicitly)', () => {
    const { guard } = buildGuard([GlobalRole.ADMIN]);

    expect(() =>
      guard.canActivate(buildContext({ globalRole: GlobalRole.SUPER_ADMIN })),
    ).toThrow(ForbiddenException);
  });

  it('reads metadata from both handler and class', () => {
    const { guard, getAllAndOverride } = buildGuard([]);

    guard.canActivate(buildContext({ globalRole: GlobalRole.USER }));

    expect(getAllAndOverride).toHaveBeenCalledWith(expect.any(String), [
      expect.anything(),
      expect.anything(),
    ]);
  });
});
