import {
  ConflictException,
  ExecutionContext,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ALLOW_GROUP_STATUSES_KEY } from '../decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from '../decorators/require-group-permission.decorator';
import { SectionMembershipStatus } from '../enums/section-membership-status.enum';
import { GroupRole } from '../enums/group-role.enum';
import { GroupStatus } from '../enums/group-status.enum';
import { GroupPermission } from '../permissions/group-permission.enum';
import { GroupPermissionService } from '../permissions/group-permission.service';
import {
  ResolvedGroupAuthorization,
  RoleAssignmentsService,
} from '../role-assignments.service';
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

  function buildAuthorization(
    roles: GroupRole[],
    groupStatus: GroupStatus,
    membershipStatus: SectionMembershipStatus = SectionMembershipStatus.ACTIVE,
  ): ResolvedGroupAuthorization {
    return {
      community: { status: groupStatus } as never,
      membership: { status: membershipStatus } as never,
      roleAssignments: roles.map((role) => ({ role }) as never),
    };
  }

  function buildGuard(options: {
    requiredPermissions?: GroupPermission[];
    allowedStatuses?: GroupStatus[];
    authorization?: ResolvedGroupAuthorization | null;
    hasAllPermissionsForRoles?: jest.Mock;
    // Only ever reached when `authorization` resolves to null AND every
    // required permission is GROUP_VIEW-only-safe - null (the default)
    // means "not a Public target either", so the existing no-authorization
    // tests still 404 exactly as before.
    publicCommunity?: unknown | null;
    // Only ever reached when `authorization` resolves to null AND every
    // required permission is GROUP_AUDIENCE_SAFE - null (the default) means
    // "not this Group's audience either".
    audienceCommunity?: unknown | null;
  }): {
    guard: GroupPermissionsGuard;
    getAllAndOverride: jest.Mock;
    resolveGroupAudienceView: jest.Mock;
  } {
    const getAllAndOverride = jest
      .fn()
      .mockImplementation((key: string) =>
        key === GROUP_PERMISSIONS_KEY
          ? options.requiredPermissions
          : options.allowedStatuses,
      );
    const reflector = { getAllAndOverride } as unknown as Reflector;

    const groupPermissionService = {
      hasAllPermissionsForRoles:
        options.hasAllPermissionsForRoles ?? jest.fn().mockReturnValue(true),
    } as unknown as GroupPermissionService;

    const resolveGroupAudienceView = jest
      .fn()
      .mockResolvedValue(options.audienceCommunity ?? null);
    const roleAssignmentsService = {
      resolveAuthorization: jest
        .fn()
        .mockResolvedValue(
          options.authorization === undefined ? null : options.authorization,
        ),
      resolvePublicView: jest
        .fn()
        .mockResolvedValue(options.publicCommunity ?? null),
      resolveGroupAudienceView,
    } as unknown as RoleAssignmentsService;

    return {
      guard: new GroupPermissionsGuard(
        reflector,
        groupPermissionService,
        roleAssignmentsService,
      ),
      getAllAndOverride,
      resolveGroupAudienceView,
    };
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

  it('throws NotFoundException when the caller has no usable authorization for the group', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_VIEW],
      authorization: null,
    });

    const error: unknown = await guard
      .canActivate(buildContext({ id: VALID_GROUP_ID }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
    expect((error as NotFoundException).getResponse()).toMatchObject({
      code: 'GROUP_NOT_FOUND',
    });
  });

  it('throws ForbiddenException when the Role Assignment lacks the required permission', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_ARCHIVE],
      authorization: buildAuthorization([GroupRole.ADMIN], GroupStatus.ACTIVE),
      hasAllPermissionsForRoles: jest.fn().mockReturnValue(false),
    });

    const error: unknown = await guard
      .canActivate(buildContext({ id: VALID_GROUP_ID }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getResponse()).toMatchObject({
      code: 'INSUFFICIENT_GROUP_PERMISSIONS',
    });
  });

  it('allows the request when the Role Assignment has the required permission', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_VIEW],
      authorization: buildAuthorization([GroupRole.MEMBER], GroupStatus.ACTIVE),
      hasAllPermissionsForRoles: jest.fn().mockReturnValue(true),
    });

    await expect(
      guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
    ).resolves.toBe(true);
  });

  it('resolves the group id from :groupId for routes nested under a Group', async () => {
    const resolveAuthorization = jest
      .fn()
      .mockResolvedValue(
        buildAuthorization([GroupRole.MEMBER], GroupStatus.ACTIVE),
      );
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockImplementation((key: string) =>
          key === GROUP_PERMISSIONS_KEY
            ? [GroupPermission.COHORT_VIEW]
            : undefined,
        ),
    } as unknown as Reflector;
    const groupPermissionService = {
      hasAllPermissionsForRoles: jest.fn().mockReturnValue(true),
    } as unknown as GroupPermissionService;
    const roleAssignmentsService = {
      resolveAuthorization,
    } as unknown as RoleAssignmentsService;
    const guard = new GroupPermissionsGuard(
      reflector,
      groupPermissionService,
      roleAssignmentsService,
    );

    await guard.canActivate(
      buildContext({ groupId: VALID_GROUP_ID, cohortId: 'cohort-1' }),
    );

    expect(resolveAuthorization).toHaveBeenCalledWith(VALID_GROUP_ID, USER_ID);
  });

  it('does not fall back to any other permission source when authorization is null - never a 403 for a non-member', async () => {
    const { guard } = buildGuard({
      requiredPermissions: [GroupPermission.GROUP_ARCHIVE],
      authorization: null,
      hasAllPermissionsForRoles: jest.fn().mockReturnValue(true),
    });

    const error: unknown = await guard
      .canActivate(buildContext({ id: VALID_GROUP_ID }))
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(NotFoundException);
  });

  describe('Public-view fallback (no RoleAssignment/Membership at all)', () => {
    it('allows a GROUP_VIEW-only request through resolvePublicView when the target is Public', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_VIEW],
        authorization: null,
        publicCommunity: { status: GroupStatus.ACTIVE },
        allowedStatuses: [
          GroupStatus.ACTIVE,
          GroupStatus.READ_ONLY,
          GroupStatus.ARCHIVED,
          GroupStatus.DELETED,
        ],
      });

      await expect(
        guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
      ).resolves.toBe(true);
    });

    it('still 404s a GROUP_VIEW-only request when resolvePublicView finds nothing (a Private, or nonexistent, target)', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_VIEW],
        authorization: null,
        publicCommunity: null,
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('never takes the fallback for a permission wider than GROUP_VIEW, even for a Public target', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.MEMBERSHIP_VIEW],
        authorization: null,
        // Even though resolvePublicView WOULD resolve one, the guard must
        // never call it for a non-GROUP_VIEW-only permission set - a
        // stranger must never see this community's member list.
        publicCommunity: { status: GroupStatus.ACTIVE },
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
    });
  });

  describe('Group audience fallback (formal / direct Section members, no Role)', () => {
    it('allows an ANNOUNCEMENT_VIEW request when the caller belongs to the Group audience', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.ANNOUNCEMENT_VIEW],
        authorization: null,
        audienceCommunity: { status: GroupStatus.ACTIVE },
      });

      await expect(
        guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
      ).resolves.toBe(true);
    });

    it('404s an ANNOUNCEMENT_VIEW request when the caller is not in the audience', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.ANNOUNCEMENT_VIEW],
        authorization: null,
        audienceCommunity: null,
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
    });

    it('never takes the audience fallback for a permission wider than ANNOUNCEMENT_VIEW', async () => {
      const { guard, resolveGroupAudienceView } = buildGuard({
        requiredPermissions: [GroupPermission.ANNOUNCEMENT_ARCHIVE_VIEW],
        authorization: null,
        audienceCommunity: { status: GroupStatus.ACTIVE },
      });

      const error: unknown = await guard
        .canActivate(buildContext({ id: VALID_GROUP_ID }))
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(NotFoundException);
      expect(resolveGroupAudienceView).not.toHaveBeenCalled();
    });
  });

  it('grants access based on the union of every Role Assignment held for the Group, not just one', async () => {
    // MEMBER alone lacks GROUP_EDIT; ADMIN alone would have it. Holding
    // both at once (see ADR-028) must grant GROUP_EDIT via the union, even
    // though this uses the *real* GroupPermissionService rather than a
    // stub, to prove the guard doesn't secretly only look at roles[0].
    const realGroupPermissionService = new GroupPermissionService();
    const resolveAuthorization = jest.fn().mockResolvedValue({
      community: { status: GroupStatus.ACTIVE },
      membership: { status: SectionMembershipStatus.ACTIVE },
      roleAssignments: [{ role: GroupRole.MEMBER }, { role: GroupRole.ADMIN }],
    });
    const reflector = {
      getAllAndOverride: jest
        .fn()
        .mockImplementation((key: string) =>
          key === GROUP_PERMISSIONS_KEY
            ? [GroupPermission.GROUP_EDIT]
            : undefined,
        ),
    } as unknown as Reflector;
    const roleAssignmentsService = {
      resolveAuthorization,
    } as unknown as RoleAssignmentsService;
    const guard = new GroupPermissionsGuard(
      reflector,
      realGroupPermissionService,
      roleAssignmentsService,
    );

    await expect(
      guard.canActivate(buildContext({ id: VALID_GROUP_ID })),
    ).resolves.toBe(true);
  });

  describe('READ_ONLY membership', () => {
    it('passes the membership status through to the permission service so READ_ONLY can restrict to view-only permissions', async () => {
      const hasAllPermissionsForRoles = jest.fn().mockReturnValue(true);
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_VIEW],
        authorization: buildAuthorization(
          [GroupRole.ADMIN],
          GroupStatus.ACTIVE,
          SectionMembershipStatus.READ_ONLY,
        ),
        hasAllPermissionsForRoles,
      });

      await guard.canActivate(buildContext({ id: VALID_GROUP_ID }));

      expect(hasAllPermissionsForRoles).toHaveBeenCalledWith(
        'SECTION',
        [GroupRole.ADMIN],
        [GroupPermission.GROUP_VIEW],
        SectionMembershipStatus.READ_ONLY,
      );
    });
  });

  describe('group-status write policy', () => {
    it('defaults to ACTIVE-only when @AllowGroupStatuses is absent', async () => {
      const { guard } = buildGuard({
        requiredPermissions: [GroupPermission.GROUP_EDIT],
        authorization: buildAuthorization(
          [GroupRole.ADMIN],
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
        authorization: buildAuthorization(
          [GroupRole.ADMIN],
          GroupStatus.ARCHIVED,
        ),
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
        authorization: buildAuthorization(
          [GroupRole.OWNER],
          GroupStatus.ACTIVE,
        ),
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
        authorization: buildAuthorization(
          [GroupRole.OWNER],
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
        authorization: buildAuthorization(
          [GroupRole.MEMBER],
          GroupStatus.ACTIVE,
        ),
      });

      await guard.canActivate(buildContext({ id: VALID_GROUP_ID }));

      expect(getAllAndOverride).toHaveBeenCalledWith(
        ALLOW_GROUP_STATUSES_KEY,
        expect.anything(),
      );
    });
  });
});
