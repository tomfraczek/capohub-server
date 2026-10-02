import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ALLOW_GROUP_STATUSES_KEY } from './decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { SectionController } from './section.controller';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { HierarchyManagementService } from './hierarchy-management.service';
import { GroupPermission } from './permissions/group-permission.enum';
import { SectionsService } from './sections.service';
import { SectionMembershipsService } from './section-memberships.service';
import { RoleAssignmentsService } from './role-assignments.service';

// Section is the only place membership/join/leave/ban/suspend/cohort
// routes exist - Group has none of these at all (see
// groups.controller.spec.ts).

function buildController(
  sectionsService: Partial<SectionsService> = {},
  sectionMembershipsService: Partial<SectionMembershipsService> = {},
  roleAssignmentsService: Partial<RoleAssignmentsService> = {},
  hierarchyManagementService: Partial<HierarchyManagementService> = {},
): SectionController {
  return new SectionController(
    sectionsService as SectionsService,
    sectionMembershipsService as SectionMembershipsService,
    roleAssignmentsService as RoleAssignmentsService,
    hierarchyManagementService as HierarchyManagementService,
  );
}

describe('SectionController', () => {
  it('is guarded by GroupPermissionsGuard at the class level', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(GUARDS_METADATA, SectionController);

    expect(guards).toEqual([GroupPermissionsGuard]);
  });

  const ANY_STATUS = [
    GroupStatus.ACTIVE,
    GroupStatus.READ_ONLY,
    GroupStatus.ARCHIVED,
    GroupStatus.DELETED,
  ];

  describe.each<
    [keyof SectionController, GroupPermission[], GroupStatus[] | undefined]
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
    ['leave', [GroupPermission.GROUP_VIEW], undefined],
    ['listMembers', [GroupPermission.MEMBERSHIP_VIEW], ANY_STATUS],
    ['addMember', [GroupPermission.MEMBERSHIP_ADD], undefined],
    ['getMembership', [GroupPermission.MEMBERSHIP_VIEW], ANY_STATUS],
    ['removeMember', [GroupPermission.MEMBERSHIP_REMOVE], undefined],
    ['banMember', [GroupPermission.MEMBERSHIP_BAN], undefined],
    ['unbanMember', [GroupPermission.MEMBERSHIP_UNBAN], undefined],
    ['suspendMember', [GroupPermission.MEMBERSHIP_SUSPEND], undefined],
    ['unsuspendMember', [GroupPermission.MEMBERSHIP_UNSUSPEND], undefined],
    ['assignCohort', [GroupPermission.MEMBERSHIP_COHORT_ASSIGN], undefined],
    ['unassignCohort', [GroupPermission.MEMBERSHIP_COHORT_ASSIGN], undefined],
  ])('%s', (method, expectedPermissions, expectedAllowedStatuses) => {
    it(`requires ${expectedPermissions.join(', ')}`, () => {
      const reflector = new Reflector();

      const handlerRef = SectionController.prototype[method];
      const metadata = reflector.get<GroupPermission[]>(
        GROUP_PERMISSIONS_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedPermissions);
    });

    it(`sets @AllowGroupStatuses(...) to ${JSON.stringify(expectedAllowedStatuses)}`, () => {
      const reflector = new Reflector();

      const handlerRef = SectionController.prototype[method];
      const metadata = reflector.get<GroupStatus[] | undefined>(
        ALLOW_GROUP_STATUSES_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedAllowedStatuses);
    });
  });

  describe('transferOwnership', () => {
    it('delegates to RoleAssignmentsService.transferOwnership with newOwnerUserId unwrapped from the body', async () => {
      const dto = { newOwner: {} } as never;
      const transferOwnership = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, {}, { transferOwnership });
      const body = { newOwnerUserId: 'user-2' } as never;
      const user = { id: 'user-1' } as never;

      const response = await controller.transferOwnership(
        'section-1',
        user,
        body,
      );

      expect(transferOwnership).toHaveBeenCalledWith(
        'section-1',
        'user-1',
        'user-2',
        user,
      );
      expect(response).toBe(dto);
    });
  });

  describe('leave', () => {
    it('delegates to SectionMembershipsService.leave', async () => {
      const leave = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { leave });
      const user = { id: 'user-1' } as never;

      await controller.leave('section-1', user);

      expect(leave).toHaveBeenCalledWith('section-1', user);
    });
  });

  describe('listMembers', () => {
    it('delegates to SectionMembershipsService.listMembers', async () => {
      const dto = [{ id: 'membership-1' }] as never;
      const listMembers = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { listMembers });

      const response = await controller.listMembers('section-1', {
        id: 'user-1',
      } as never);

      expect(listMembers).toHaveBeenCalledWith('section-1', 'user-1');
      expect(response).toBe(dto);
    });
  });

  describe('addMember', () => {
    it('delegates to SectionMembershipsService.addMember with the actor', async () => {
      const dto = { id: 'membership-1' } as never;
      const addMember = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { addMember });
      const body = { userId: 'user-2' } as never;
      const user = { id: 'user-1' } as never;

      const response = await controller.addMember('section-1', body, user);

      expect(addMember).toHaveBeenCalledWith('section-1', body, user);
      expect(response).toBe(dto);
    });
  });

  describe('getMembership', () => {
    it('delegates to SectionMembershipsService.getMembership', async () => {
      const dto = { id: 'membership-1' } as never;
      const getMembership = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { getMembership });

      const response = await controller.getMembership(
        'section-1',
        'membership-1',
        { id: 'user-1' } as never,
      );

      expect(getMembership).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        'user-1',
      );
      expect(response).toBe(dto);
    });
  });

  describe('removeMember', () => {
    it('delegates to SectionMembershipsService.removeMember', async () => {
      const removeMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { removeMember });
      const user = { id: 'user-1' } as never;

      await controller.removeMember('section-1', 'membership-1', user);

      expect(removeMember).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        user,
      );
    });
  });

  describe('banMember', () => {
    it('delegates to SectionMembershipsService.banMember', async () => {
      const banMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { banMember });
      const user = { id: 'user-1' } as never;
      const body = { reason: 'Repeated rule violations' } as never;

      await controller.banMember('section-1', 'membership-1', body, user);

      expect(banMember).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        user,
        'Repeated rule violations',
      );
    });

    it('passes null when no reason is given', async () => {
      const banMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { banMember });
      const user = { id: 'user-1' } as never;

      await controller.banMember('section-1', 'membership-1', {}, user);

      expect(banMember).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        user,
        null,
      );
    });
  });

  describe('unbanMember', () => {
    it('delegates to SectionMembershipsService.unbanMember', async () => {
      const unbanMember = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { unbanMember });
      const user = { id: 'user-1' } as never;

      await controller.unbanMember('section-1', 'membership-1', user);

      expect(unbanMember).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        user,
      );
    });
  });

  describe('suspendMember', () => {
    it('delegates to SectionMembershipsService.suspendMember, converting until to a Date', async () => {
      const dto = { id: 'membership-1' } as never;
      const suspendMember = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { suspendMember });
      const user = { id: 'user-1' } as never;
      const until = '2026-08-01T00:00:00.000Z';

      const response = await controller.suspendMember(
        'section-1',
        'membership-1',
        { until, reason: 'Cooldown' },
        user,
      );

      expect(suspendMember).toHaveBeenCalledWith(
        'section-1',
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

      await controller.suspendMember('section-1', 'membership-1', {}, user);

      expect(suspendMember).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        user,
        null,
        null,
      );
    });
  });

  describe('unsuspendMember', () => {
    it('delegates to SectionMembershipsService.unsuspendMember', async () => {
      const dto = { id: 'membership-1' } as never;
      const unsuspendMember = jest.fn().mockResolvedValue(dto);
      const controller = buildController({}, { unsuspendMember });
      const user = { id: 'user-1' } as never;

      const response = await controller.unsuspendMember(
        'section-1',
        'membership-1',
        user,
      );

      expect(unsuspendMember).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        user,
      );
      expect(response).toBe(dto);
    });
  });

  describe('assignCohort', () => {
    it('delegates to SectionMembershipsService.assignCohort', async () => {
      const assignCohort = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { assignCohort });

      await controller.assignCohort('section-1', 'membership-1', 'cohort-1');

      expect(assignCohort).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        'cohort-1',
      );
    });
  });

  describe('unassignCohort', () => {
    it('delegates to SectionMembershipsService.unassignCohort', async () => {
      const unassignCohort = jest.fn().mockResolvedValue(undefined);
      const controller = buildController({}, { unassignCohort });

      await controller.unassignCohort('section-1', 'membership-1', 'cohort-1');

      expect(unassignCohort).toHaveBeenCalledWith(
        'section-1',
        'membership-1',
        'cohort-1',
      );
    });
  });
});
