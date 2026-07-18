import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { AdminRhythmsController } from './admin-rhythms.controller';
import { RhythmsService } from './rhythms.service';

describe('AdminRhythmsController', () => {
  it('is guarded by PermissionsGuard and requires MUSIC_CONTENT_MANAGE', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(
      GUARDS_METADATA,
      AdminRhythmsController,
    );
    const permissions = reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      AdminRhythmsController,
    );

    expect(guards).toEqual([PermissionsGuard]);
    expect(permissions).toEqual([Permission.MUSIC_CONTENT_MANAGE]);
  });

  describe('list', () => {
    it('delegates to RhythmsService.adminList', async () => {
      const dto = [{ id: 'rhythm-1' }] as never;
      const adminList = jest.fn().mockResolvedValue(dto);
      const controller = new AdminRhythmsController({
        adminList,
      } as unknown as RhythmsService);

      const response = await controller.list();

      expect(adminList).toHaveBeenCalled();
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to RhythmsService.adminGetById', async () => {
      const dto = { id: 'rhythm-1' } as never;
      const adminGetById = jest.fn().mockResolvedValue(dto);
      const controller = new AdminRhythmsController({
        adminGetById,
      } as unknown as RhythmsService);

      const response = await controller.getById('rhythm-1');

      expect(adminGetById).toHaveBeenCalledWith('rhythm-1');
      expect(response).toBe(dto);
    });
  });

  describe('create', () => {
    it('delegates to RhythmsService.create with the validated body', async () => {
      const dto = { id: 'rhythm-1' } as never;
      const create = jest.fn().mockResolvedValue(dto);
      const controller = new AdminRhythmsController({
        create,
      } as unknown as RhythmsService);
      const body = { name: 'São Bento Grande' } as never;

      const response = await controller.create(body);

      expect(create).toHaveBeenCalledWith(body);
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to RhythmsService.update with id and body', async () => {
      const dto = { id: 'rhythm-1' } as never;
      const update = jest.fn().mockResolvedValue(dto);
      const controller = new AdminRhythmsController({
        update,
      } as unknown as RhythmsService);
      const body = { name: 'São Bento Grande' } as never;

      const response = await controller.update('rhythm-1', body);

      expect(update).toHaveBeenCalledWith('rhythm-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('delete', () => {
    it('delegates to RhythmsService.delete', async () => {
      const del = jest.fn().mockResolvedValue(undefined);
      const controller = new AdminRhythmsController({
        delete: del,
      } as unknown as RhythmsService);

      const response = await controller.delete('rhythm-1');

      expect(del).toHaveBeenCalledWith('rhythm-1');
      expect(response).toBeUndefined();
    });
  });
});
