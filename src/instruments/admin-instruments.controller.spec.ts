import { GUARDS_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from '../auth/guards/permissions.guard';
import { PERMISSIONS_KEY } from '../auth/decorators/permissions.decorator';
import { Permission } from '../auth/permissions/permission.enum';
import { AdminInstrumentsController } from './admin-instruments.controller';
import { InstrumentsService } from './instruments.service';

describe('AdminInstrumentsController', () => {
  it('is guarded by PermissionsGuard and requires MUSIC_CONTENT_MANAGE', () => {
    const reflector = new Reflector();

    const guards = reflector.get<unknown[]>(
      GUARDS_METADATA,
      AdminInstrumentsController,
    );
    const permissions = reflector.get<Permission[]>(
      PERMISSIONS_KEY,
      AdminInstrumentsController,
    );

    expect(guards).toEqual([PermissionsGuard]);
    expect(permissions).toEqual([Permission.MUSIC_CONTENT_MANAGE]);
  });

  describe('list', () => {
    it('delegates to InstrumentsService.adminList', async () => {
      const dto = [{ id: 'instrument-1' }] as never;
      const adminList = jest.fn().mockResolvedValue(dto);
      const controller = new AdminInstrumentsController({
        adminList,
      } as unknown as InstrumentsService);

      const response = await controller.list();

      expect(adminList).toHaveBeenCalled();
      expect(response).toBe(dto);
    });
  });

  describe('getById', () => {
    it('delegates to InstrumentsService.adminGetById', async () => {
      const dto = { id: 'instrument-1' } as never;
      const adminGetById = jest.fn().mockResolvedValue(dto);
      const controller = new AdminInstrumentsController({
        adminGetById,
      } as unknown as InstrumentsService);

      const response = await controller.getById('instrument-1');

      expect(adminGetById).toHaveBeenCalledWith('instrument-1');
      expect(response).toBe(dto);
    });
  });

  describe('create', () => {
    it('delegates to InstrumentsService.create with the validated body', async () => {
      const dto = { id: 'instrument-1' } as never;
      const create = jest.fn().mockResolvedValue(dto);
      const controller = new AdminInstrumentsController({
        create,
      } as unknown as InstrumentsService);
      const body = { name: 'Berimbau' } as never;

      const response = await controller.create(body);

      expect(create).toHaveBeenCalledWith(body);
      expect(response).toBe(dto);
    });
  });

  describe('update', () => {
    it('delegates to InstrumentsService.update with id and body', async () => {
      const dto = { id: 'instrument-1' } as never;
      const update = jest.fn().mockResolvedValue(dto);
      const controller = new AdminInstrumentsController({
        update,
      } as unknown as InstrumentsService);
      const body = { name: 'Berimbau' } as never;

      const response = await controller.update('instrument-1', body);

      expect(update).toHaveBeenCalledWith('instrument-1', body);
      expect(response).toBe(dto);
    });
  });

  describe('delete', () => {
    it('delegates to InstrumentsService.delete', async () => {
      const del = jest.fn().mockResolvedValue(undefined);
      const controller = new AdminInstrumentsController({
        delete: del,
      } as unknown as InstrumentsService);

      const response = await controller.delete('instrument-1');

      expect(del).toHaveBeenCalledWith('instrument-1');
      expect(response).toBeUndefined();
    });
  });
});
