import { ServiceUnavailableException } from '@nestjs/common';
import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { AppConfigService } from '../config/app.config';
import { IMAGE_CACHE_CONTROL } from './image-upload.constants';
import { R2StorageService } from './r2-storage.service';

function buildAppConfig(): AppConfigService {
  return {
    r2Bucket: 'capohub',
    r2PublicUrl: 'https://pub-abc123.r2.dev',
  } as unknown as AppConfigService;
}

type SentCommand = PutObjectCommand | DeleteObjectCommand;

describe('R2StorageService', () => {
  // Never a real S3Client (module spec §32/§46: no real request to
  // Cloudflare) - just enough of the shape R2StorageService calls
  // (`.send(command)`) to assert against. Explicitly typed (not a bare
  // `jest.fn()`) so `.mock.calls[0][0]` below resolves to `SentCommand`
  // rather than `any`.
  function buildClient(): {
    send: jest.Mock<Promise<unknown>, [SentCommand]>;
  } {
    return { send: jest.fn<Promise<unknown>, [SentCommand]>() };
  }

  describe('putObject', () => {
    it('sends a PutObjectCommand with the bucket, key, content type, cache control and body', async () => {
      const client = buildClient();
      client.send.mockResolvedValue({});
      const service = new R2StorageService(client as never, buildAppConfig());
      const body = Buffer.from('fake-webp-bytes');

      await service.putObject('users/u1/profile/uuid.webp', body, 'image/webp');

      expect(client.send).toHaveBeenCalledTimes(1);
      const command = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(PutObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'capohub',
        Key: 'users/u1/profile/uuid.webp',
        Body: body,
        ContentType: 'image/webp',
        CacheControl: IMAGE_CACHE_CONTROL,
      });
    });

    it('wraps a failed upload in a ServiceUnavailableException with code IMAGE_UPLOAD_FAILED, never the raw SDK error', async () => {
      const client = buildClient();
      client.send.mockRejectedValue(new Error('R2 is down'));
      const service = new R2StorageService(client as never, buildAppConfig());

      await expect(
        service.putObject(
          'users/u1/profile/uuid.webp',
          Buffer.from('x'),
          'image/webp',
        ),
      ).rejects.toMatchObject(
        new ServiceUnavailableException({
          code: 'IMAGE_UPLOAD_FAILED',
          message: 'Failed to upload image - please try again',
        }),
      );
    });
  });

  describe('deleteObject', () => {
    it('sends a DeleteObjectCommand with the bucket and key', async () => {
      const client = buildClient();
      client.send.mockResolvedValue({});
      const service = new R2StorageService(client as never, buildAppConfig());

      await service.deleteObject('users/u1/profile/uuid.webp');

      const command = client.send.mock.calls[0][0];
      expect(command).toBeInstanceOf(DeleteObjectCommand);
      expect(command.input).toEqual({
        Bucket: 'capohub',
        Key: 'users/u1/profile/uuid.webp',
      });
    });

    it('propagates a failed delete to the caller unchanged - no logging/catching of its own', async () => {
      const client = buildClient();
      const error = new Error('R2 is down');
      client.send.mockRejectedValue(error);
      const service = new R2StorageService(client as never, buildAppConfig());

      await expect(
        service.deleteObject('users/u1/profile/uuid.webp'),
      ).rejects.toBe(error);
    });
  });

  describe('buildPublicUrl', () => {
    it('joins the public URL base and the object key with exactly one slash', () => {
      const service = new R2StorageService({} as never, buildAppConfig());

      expect(service.buildPublicUrl('users/u1/profile/uuid.webp')).toBe(
        'https://pub-abc123.r2.dev/users/u1/profile/uuid.webp',
      );
    });

    it('handles a trailing slash on R2_PUBLIC_URL without producing a double slash', () => {
      const service = new R2StorageService(
        {} as never,
        {
          r2Bucket: 'capohub',
          r2PublicUrl: 'https://pub-abc123.r2.dev/',
        } as unknown as AppConfigService,
      );

      expect(service.buildPublicUrl('groups/g1/profile/uuid.webp')).toBe(
        'https://pub-abc123.r2.dev/groups/g1/profile/uuid.webp',
      );
    });

    it('handles a leading slash on the object key without producing a double slash', () => {
      const service = new R2StorageService({} as never, buildAppConfig());

      expect(service.buildPublicUrl('/events/e1/cover/uuid.webp')).toBe(
        'https://pub-abc123.r2.dev/events/e1/cover/uuid.webp',
      );
    });
  });
});
