import { ImageAssetService } from './image-asset.service';
import { IMAGE_OUTPUT_CONTENT_TYPE } from './image-upload.constants';
import { R2StorageService } from './r2-storage.service';

function buildStorage(): {
  storage: R2StorageService;
  putObject: jest.Mock;
  deleteObject: jest.Mock;
} {
  const putObject = jest.fn().mockResolvedValue(undefined);
  const deleteObject = jest.fn().mockResolvedValue(undefined);
  return {
    storage: { putObject, deleteObject } as unknown as R2StorageService,
    putObject,
    deleteObject,
  };
}

describe('ImageAssetService', () => {
  describe('replace', () => {
    it('first upload: uploads the new object and persists it - no delete, since there is no old object', async () => {
      const { storage, putObject, deleteObject } = buildStorage();
      const service = new ImageAssetService(storage);
      const persist = jest.fn().mockResolvedValue(undefined);
      const buffer = Buffer.from('webp-bytes');

      await service.replace({
        processedBuffer: buffer,
        newKey: 'users/u1/profile/new.webp',
        oldKey: null,
        persist,
        logContext: { resourceType: 'user-avatar', resourceId: 'u1' },
      });

      expect(putObject).toHaveBeenCalledWith(
        'users/u1/profile/new.webp',
        buffer,
        IMAGE_OUTPUT_CONTENT_TYPE,
      );
      expect(persist).toHaveBeenCalledWith('users/u1/profile/new.webp');
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('replace: uploads the new object, persists it, then deletes the old one', async () => {
      const { storage, putObject, deleteObject } = buildStorage();
      const service = new ImageAssetService(storage);
      const persist = jest.fn().mockResolvedValue(undefined);

      await service.replace({
        processedBuffer: Buffer.from('x'),
        newKey: 'users/u1/profile/new.webp',
        oldKey: 'users/u1/profile/old.webp',
        persist,
        logContext: { resourceType: 'user-avatar', resourceId: 'u1' },
      });

      expect(putObject).toHaveBeenCalledTimes(1);
      expect(persist).toHaveBeenCalledTimes(1);
      expect(deleteObject).toHaveBeenCalledWith('users/u1/profile/old.webp');
      // Order matters: persist before the old-object delete.
      const persistOrder = persist.mock.invocationCallOrder[0];
      const deleteOrder = deleteObject.mock.invocationCallOrder[0];
      expect(persistOrder).toBeLessThan(deleteOrder);
    });

    it('upload failure: DB is never touched and the old object is left alone', async () => {
      const { storage, putObject, deleteObject } = buildStorage();
      putObject.mockRejectedValue(new Error('R2 down'));
      const service = new ImageAssetService(storage);
      const persist = jest.fn();

      await expect(
        service.replace({
          processedBuffer: Buffer.from('x'),
          newKey: 'users/u1/profile/new.webp',
          oldKey: 'users/u1/profile/old.webp',
          persist,
          logContext: { resourceType: 'user-avatar', resourceId: 'u1' },
        }),
      ).rejects.toThrow('R2 down');

      expect(persist).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('DB failure after a successful upload: best-effort deletes the orphaned new object, then rethrows - old object is untouched', async () => {
      const { storage, deleteObject } = buildStorage();
      const service = new ImageAssetService(storage);
      const dbError = new Error('flush failed');
      const persist = jest.fn().mockRejectedValue(dbError);

      await expect(
        service.replace({
          processedBuffer: Buffer.from('x'),
          newKey: 'users/u1/profile/new.webp',
          oldKey: 'users/u1/profile/old.webp',
          persist,
          logContext: { resourceType: 'user-avatar', resourceId: 'u1' },
        }),
      ).rejects.toBe(dbError);

      expect(deleteObject).toHaveBeenCalledTimes(1);
      expect(deleteObject).toHaveBeenCalledWith('users/u1/profile/new.webp');
    });

    it('old-object delete failure after a successful replace: the request still succeeds, no throw', async () => {
      const { storage, deleteObject } = buildStorage();
      deleteObject.mockRejectedValue(new Error('delete failed'));
      const service = new ImageAssetService(storage);
      const persist = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.replace({
          processedBuffer: Buffer.from('x'),
          newKey: 'users/u1/profile/new.webp',
          oldKey: 'users/u1/profile/old.webp',
          persist,
          logContext: { resourceType: 'user-avatar', resourceId: 'u1' },
        }),
      ).resolves.toBeUndefined();

      expect(persist).toHaveBeenCalled();
    });
  });

  describe('remove', () => {
    it('is idempotent when there is nothing to delete - persist is never called', async () => {
      const { storage, deleteObject } = buildStorage();
      const service = new ImageAssetService(storage);
      const persist = jest.fn();

      await service.remove({
        oldKey: null,
        persist,
        logContext: { resourceType: 'group-profile-image', resourceId: 'g1' },
      });

      expect(persist).not.toHaveBeenCalled();
      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('persists first, then deletes the R2 object', async () => {
      const { storage, deleteObject } = buildStorage();
      const service = new ImageAssetService(storage);
      const persist = jest.fn().mockResolvedValue(undefined);

      await service.remove({
        oldKey: 'groups/g1/profile/old.webp',
        persist,
        logContext: { resourceType: 'group-profile-image', resourceId: 'g1' },
      });

      expect(persist).toHaveBeenCalledTimes(1);
      expect(deleteObject).toHaveBeenCalledWith('groups/g1/profile/old.webp');
      expect(persist.mock.invocationCallOrder[0]).toBeLessThan(
        deleteObject.mock.invocationCallOrder[0],
      );
    });

    it('R2 delete failure after a successful DB clear: the request still succeeds, no throw', async () => {
      const { storage, deleteObject } = buildStorage();
      deleteObject.mockRejectedValue(new Error('delete failed'));
      const service = new ImageAssetService(storage);
      const persist = jest.fn().mockResolvedValue(undefined);

      await expect(
        service.remove({
          oldKey: 'groups/g1/profile/old.webp',
          persist,
          logContext: { resourceType: 'group-profile-image', resourceId: 'g1' },
        }),
      ).resolves.toBeUndefined();

      expect(persist).toHaveBeenCalled();
    });
  });

  describe('cleanupOrphan', () => {
    it('is a no-op for a null key', async () => {
      const { storage, deleteObject } = buildStorage();
      const service = new ImageAssetService(storage);

      await service.cleanupOrphan(null, {}, 'test');

      expect(deleteObject).not.toHaveBeenCalled();
    });

    it('logs and swallows a delete failure rather than throwing', async () => {
      const { storage, deleteObject } = buildStorage();
      deleteObject.mockRejectedValue(new Error('boom'));
      const service = new ImageAssetService(storage);

      await expect(
        service.cleanupOrphan('users/u1/profile/old.webp', {}, 'test'),
      ).resolves.toBeUndefined();
    });
  });
});
