import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ALLOW_GROUP_STATUSES_KEY } from '../decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from '../decorators/require-group-permission.decorator';
import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupPermission } from '../permissions/group-permission.enum';
import { GroupPermissionService } from '../permissions/group-permission.service';
import { GroupPermissionsGuard } from './group-permissions.guard';

const VALID_GROUP_ID = '11111111-1111-4111-8111-111111111111';
const USER_ID = 'user-1';

describe('GroupPermissionsGuard', () => {
  function buildContext(params: Record<string, string>): ExecutionContext {
    return {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => ({
          params,
          localUser: { id: USER_ID },
        }),
      }),
    } as unknown as ExecutionContext;
  }

  function buildGuard(options: {
    requiredPermissions?: GroupPermission[];
    allowedStatuses?: GroupStatus[];
    membership?: { role: GroupRole; rootGroup: { status: GroupStatus } } | null;
    hasAllPermissions?: jest.Mock;
  }): { guard: GroupPermissionsGuard; getAllAndOverride: jest.Mock } {
    const getAllAndOverride = jest
      .fn()
      .mockImplementation((key: string) =>
        key === GROUP_PERMISSIONS_KEY
          ? options.requiredPermissions
          : options.allowedStatuses,
      );
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const groupPermissionService = {
      hasAllPermissions:
        options.hasAllPermissions ?? jest.fn().mockReturnValue(true),
    } as unknown as GroupPermissionService;

    const findOne = jest
      .fn()
      .mockResolvedValue(
        options.membership === undefined ? null : options.membership,
      );
    const em = { findOne } as unknown as EntityManager;

    return {
      guard: new GroupPermissionsGuard(reflector, groupPermissionService, em),
      getAllAndOverride,
    };
  }

  function membershipWithStatus(role: GroupRole, status: GroupStatus) {
    return { role, rootGroup: { status } };
  }

  it('allows the request when no group permissions metadata is set', async () => {
    const { guard } = buildGuard({ requiredPermissions: undefined });

    await expect(
      guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
    ).resolves.toBe(true);
  });

  it('throws NotFoundException when the :id param is not a valid UUID', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_VIEW],
    });

    await expect(
      guard.canActivate(buildContext({ id: 'not-a-uuid' })),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('throws NotFoundException when the user has no active membership', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_VIEW],
      membership: null,
    });

    const error: unknown = await guard
      .canActivate(buildContext({ id: VALID_GROUP_ID }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'GROUP_NOT_FOUND',
    });
  });

  it('throws ForbiddenException when the role lacks the required permission', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_ARCHIVE],
      membership: membershipWithStatus(GroupRole.ADMIN, GroupStatus.ACTIVE),
      hasAllPermissions: jest.fn().mockReturnValue(false),
    });

    const error: unknown = await guard
      .canActivate(buildContext({ id: VALID_GROUP_ID }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'INSUFFICIENT_GROUP_PERMISSIONS',
    });
  });

  it('allows the request when the active membership has the required permission', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_VIEW],
      membership: membershipWithStatus(GroupRole.MEMBER, GroupStatus.ACTIVE),
      hasAllPermissions: jest.fn().mockReturnValue(true),
    });

    await expect(
      guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
    ).resolves.toBe(true);
  });

  describe('group-status write policy', () => {
    it('defaults to ACTIVE-only when @AllowGroupStatuses is absent', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_EDIT],
        membership: membershipWithStatus(
          GroupRole.ADMIN,
          GroupStatus.READ_ONLY,
        ),
        allowedStatuses: undefined,
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'GROUP_READ_ONLY',
      });
    });

    it('blocks with 409 GROUP_ARCHIVED when the group is archived and not in the allow-list', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_EDIT],
        membership: membershipWithStatus(GroupRole.ADMIN, GroupStatus.ARCHIVED),
        allowedStatuses: [GroupStatus.ACTIVE],
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'GROUP_ARCHIVED',
      });
    });

    it('blocks with 409 GROUP_ACTIVE when the group is active and not in the allow-list', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_UNARCHIVE],
        membership: membershipWithStatus(GroupRole.OWNER, GroupStatus.ACTIVE),
        allowedStatuses: [GroupStatus.ARCHIVED],
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'GROUP_ACTIVE',
      });
    });

    it('allows a permitted action when the current status is in the allow-list', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_ARCHIVE],
        membership: membershipWithStatus(
          GroupRole.OWNER,
          GroupStatus.READ_ONLY,
        ),
        allowedStatuses: [GroupStatus.ACTIVE, GroupStatus.READ_ONLY],
      });

      await expect(
        guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
      ).resolves.toBe(true);
    });

    it('checks the AllowGroupStatuses metadata key', async () => {
      const { guard, getAllAndOverride } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_VIEW],
        membership: membershipWithStatus(GroupRole.MEMBER, GroupStatus.ACTIVE),
      });

      await guard.canActivate(buildContext({ id: VALID_GROUP_ID }));

      expect(getAllAndOverride).toHaveBeenCalledWith(
        ALLOW_GROUP_STATUSES_KEY,
        expect.anything(),
      );
    });
  });
});
