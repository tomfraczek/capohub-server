import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { ALLOW_GROUP_STATUSES_KEY } from './decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';
import { CohortsController } from './cohorts.controller';
import { CohortsService } from './cohorts.service';

function buildController(
  cohortsService: Partial<CohortsService> = {},
): CohortsController {
  return new CohortsController(cohortsService as CohortsService);
}

describe('CohortsController', () => {
  it('is guarded by GroupPermissionsGuard at the class level', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(GUARDS_METADATA, CohortsController);

    expect(guards).toEqual([GroupPermissionsGuard]);
  });

  const ANY_STATUS = [
    GroupStatus.ACTIVE,
    GroupStatus.READ_ONLY,
    GroupStatus.ARCHIVED,
    GroupStatus.DELETED,
  ];

  describe.each<
    [keyof CohortsController, GroupPermission[], GroupStatus[] | undefined]
  >([
    ['create', [GroupPermission.COHORT_CREATE], undefined],
    ['list', [GroupPermission.COHORT_VIEW], ANY_STATUS],
    ['getById', [GroupPermission.COHORT_VIEW], ANY_STATUS],
    ['update', [GroupPermission.COHORT_EDIT], undefined],
    ['archive', [GroupPermission.COHORT_ARCHIVE], undefined],
  ])('%s', (method, expectedPermissions, expectedAllowedStatuses) => {
    it(`requires ${expectedPermissions.join(', ')}`, () => {
      const reflector = new Reflector();

      const handlerRef = CohortsController.prototype[method];
      const metadata = reflector.get<GroupPermission[]>(
        GROUP_PERMISSIONS_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedPermissions);
    });

    it(`sets @AllowGroupStatuses(...) to ${JSON.stringify(expectedAllowedStatuses)}`, () => {
      const reflector = new Reflector();

      const handlerRef = CohortsController.prototype[method];
      const metadata = reflector.get<GroupStatus[] | undefined>(
        ALLOW_GROUP_STATUSES_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedAllowedStatuses);
    });
  });

  describe('create', () => {
    it('delegates to CohortsService.create', async () => {
      const dto = { id: 'cohort-1' } as never;
      const create = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ create });
      const body = { name: 'Kids' } as never;

      const response = await controller.create(
        'group-1',
        undefined as never,
        body,
      );

      expect(create).toHaveBeenCalledWith('group-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('list', () => {
    it('delegates to CohortsService.list', async () => {
      const dto = [{ id: 'cohort-1' }] as never;
      const list = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ list });

      const response = await controller.list('group-1', undefined as never);

      expect(list).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to CohortsService.getById', async () => {
      const dto = { id: 'cohort-1' } as never;
      const getById = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ getById });

      const response = await controller.getById(
        'group-1',
        undefined as never,
        'cohort-1',
      );

      expect(getById).toHaveBeenCalledWith('group-1', 'cohort-1');
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to CohortsService.update', async () => {
      const dto = { id: 'cohort-1' } as never;
      const update = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ update });
      const body = { name: 'New name' } as never;

      const response = await controller.update(
        'group-1',
        undefined as never,
        'cohort-1',
        body,
      );

      expect(update).toHaveBeenCalledWith('group-1', 'cohort-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('archive', () => {
    it('delegates to CohortsService.archive', async () => {
      const dto = { id: 'cohort-1' } as never;
      const archive = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ archive });

      const response = await controller.archive(
        'group-1',
        undefined as never,
        'cohort-1',
      );

      expect(archive).toHaveBeenCalledWith('group-1', 'cohort-1');
      expect(response).toBe(dto);
    });
  });
});
