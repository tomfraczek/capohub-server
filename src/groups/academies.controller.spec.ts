import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { AcademiesController } from './academies.controller';
import { AcademiesService } from './academies.service';
import { ALLOW_GROUP_STATUSES_KEY } from './decorators/allow-group-statuses.decorator';
import { GROUP_PERMISSIONS_KEY } from './decorators/require-group-permission.decorator';
import { GroupStatus } from './enums/group-status.enum';
import { GroupPermissionsGuard } from './guards/group-permissions.guard';
import { GroupPermission } from './permissions/group-permission.enum';

function buildController(
  academiesService: Partial<AcademiesService> = {},
): AcademiesController {
  return new AcademiesController(academiesService as AcademiesService);
}

describe('AcademiesController', () => {
  it('is guarded by GroupPermissionsGuard at the class level', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(
      GUARDS_METADATA,
      AcademiesController,
    );

    expect(guards).toEqual([GroupPermissionsGuard]);
  });

  const ANY_STATUS = [
    GroupStatus.ACTIVE,
    GroupStatus.READ_ONLY,
    GroupStatus.ARCHIVED,
  ];

  describe.each<
    [keyof AcademiesController, GroupPermission[], GroupStatus[] | undefined]
  >([
    ['create', [GroupPermission.ACADEMY_CREATE], undefined],
    ['list', [GroupPermission.ACADEMY_VIEW], ANY_STATUS],
    ['getById', [GroupPermission.ACADEMY_VIEW], ANY_STATUS],
    ['update', [GroupPermission.ACADEMY_EDIT], undefined],
    ['archive', [GroupPermission.ACADEMY_ARCHIVE], undefined],
  ])('%s', (method, expectedPermissions, expectedAllowedStatuses) => {
    it(`requires ${expectedPermissions.join(', ')}`, () => {
      const reflector = new Reflector();

      const handlerRef = AcademiesController.prototype[method];
      const metadata = reflector.get<GroupPermission[]>(
        GROUP_PERMISSIONS_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedPermissions);
    });

    it(`sets @AllowGroupStatuses(...) to ${JSON.stringify(expectedAllowedStatuses)}`, () => {
      const reflector = new Reflector();

      const handlerRef = AcademiesController.prototype[method];
      const metadata = reflector.get<GroupStatus[] | undefined>(
        ALLOW_GROUP_STATUSES_KEY,
        handlerRef,
      );

      expect(metadata).toEqual(expectedAllowedStatuses);
    });
  });

  describe('create', () => {
    it('delegates to AcademiesService.create', async () => {
      const dto = { id: 'academy-1' } as never;
      const create = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ create });
      const body = { name: 'Center' } as never;

      const response = await controller.create('group-1', body);

      expect(create).toHaveBeenCalledWith('group-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('list', () => {
    it('delegates to AcademiesService.list', async () => {
      const dto = [{ id: 'academy-1' }] as never;
      const list = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ list });

      const response = await controller.list('group-1');

      expect(list).toHaveBeenCalledWith('group-1');
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to AcademiesService.getById', async () => {
      const dto = { id: 'academy-1' } as never;
      const getById = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ getById });

      const response = await controller.getById('group-1', 'academy-1');

      expect(getById).toHaveBeenCalledWith('group-1', 'academy-1');
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to AcademiesService.update', async () => {
      const dto = { id: 'academy-1' } as never;
      const update = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ update });
      const body = { name: 'New name' } as never;

      const response = await controller.update('group-1', 'academy-1', body);

      expect(update).toHaveBeenCalledWith('group-1', 'academy-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('archive', () => {
    it('delegates to AcademiesService.archive', async () => {
      const dto = { id: 'academy-1' } as never;
      const archive = jest.fn().mockResolvedValue(dto);
      const controller = buildController({ archive });

      const response = await controller.archive('group-1', 'academy-1');

      expect(archive).toHaveBeenCalledWith('group-1', 'academy-1');
      expect(response).toBe(dto);
    });
  });
});
