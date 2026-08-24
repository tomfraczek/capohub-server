import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { AppConfigService } from '../config/app.config';
import { IMAGE_CACHE_CONTROL } from './image-upload.constants';
import { R2_CLIENT } from './r2-client.provider';

/**
 * Thin wrapper around the R2 (S3-compatible) client - the only place in the
 * project that talks to Cloudflare R2 directly. Deliberately carries no
 * domain knowledge (no "profile image" vs "cover" distinction, no replace/
 * delete orchestration - see ImageAssetService for that): just three
 * primitives (module spec §13), each independently mockable in unit tests
 * and independently overridable as a whole in e2e tests (see
 * r2-client.provider.ts's own comment).
 */
@Injectable()
export class R2StorageService {
  private readonly logger = new Logger(R2StorageService.name);

  constructor(
    @Inject(R2_CLIENT) private readonly client: S3Client,
    private readonly appConfig: AppConfigService,
  ) {}

  /**
   * Uploads `body` under `key`, overwriting whatever (if anything) is
   * already there - callers never reuse a key across two different images
   * (see object-keys.util.ts), so this never actually overwrites a live
   * object in practice. A failure here always means the calling
   * replace/delete flow has made no DB change yet (see
   * image-asset.service.ts's `replace` - putObject always runs before any
   * DB write), so it is safe to surface directly as a request failure
   * rather than something a caller needs to catch and recover from.
   */
  async putObject(
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    try {
      await this.client.send(
        new PutObjectCommand({
          Bucket: this.appConfig.r2Bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: IMAGE_CACHE_CONTROL,
        }),
      );
    } catch (error) {
      // Never surface the raw AWS SDK error to the client (module spec
      // §42) - only ever this fixed, opaque code/message. The underlying
      // error (never the request body/credentials) is logged for
      // operators.
      this.logger.error(
        `R2 putObject failed: key=${key} error=${(error as Error).message}`,
      );
      throw new ServiceUnavailableException({
        code: 'IMAGE_UPLOAD_FAILED',
        message: 'Failed to upload image - please try again',
      });
    }
  }

  /**
   * Deletes the object at `key`. Deliberately does NOT catch/log here -
   * unlike putObject, a delete failure means two structurally different
   * things depending on where it is called from (a live "please delete my
   * photo" request vs. best-effort orphan cleanup after a successful
   * replace/delete), and only the caller (see ImageAssetService) knows
   * which, and what resource/id to log against (module spec §41's
   * "resource type, resource id, object key, error message" - none of
   * which this generic service has).
   */
  async deleteObject(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.appConfig.r2Bucket, Key: key }),
    );
  }

  /**
   * Builds the public URL for `key` from R2_PUBLIC_URL - the one central
   * place this project turns a stored object key into something the
   * frontend can load (module spec §11/§15). Handles a trailing slash on
   * the base and/or a leading slash on the key so neither produces
   * `//users/...` or a mangled path; never URL-encodes the key itself -
   * every key this codebase generates (see object-keys.util.ts) is already
   * a plain, safe path of slugs/uuids.
   */
  buildPublicUrl(key: string): string {
    const base = this.appConfig.r2PublicUrl.endsWith('/')
      ? this.appConfig.r2PublicUrl.slice(0, -1)
      : this.appConfig.r2PublicUrl;
    const cleanKey = key.startsWith('/') ? key.slice(1) : key;
    return `${base}/${cleanKey}`;
  }
}
