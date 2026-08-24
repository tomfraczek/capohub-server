import { Injectable, Logger } from '@nestjs/common';
import { IMAGE_OUTPUT_CONTENT_TYPE } from './image-upload.constants';
import { R2StorageService } from './r2-storage.service';

export interface ReplaceImageParams {
  /** Already resized/re-encoded WebP bytes - see ImageProcessingService. */
  processedBuffer: Buffer;
  /** Freshly generated key for the new object - see object-keys.util.ts. */
  newKey: string;
  /** The resource's current key, if any - null on a first-ever upload. */
  oldKey: string | null;
  /** Persists `newKey` (plus whatever else the caller's domain needs to
   * change alongside it - avatarType, presetAvatarId, clearing the legacy
   * URL column, ...) and flushes. */
  persist: (newKey: string) => Promise<void>;
  /** Identifies the resource for the cleanup-failure log line (module spec
   * §41) - never anything sensitive. */
  logContext: Record<string, string>;
}

export interface RemoveImageParams {
  oldKey: string | null;
  /** Clears the resource's key (and whatever else) and flushes. Never
   * called at all when `oldKey` is already null - see `remove` below. */
  persist: () => Promise<void>;
  logContext: Record<string, string>;
}

/**
 * The one replace/delete orchestration shared by every "at most one current
 * image per resource" upload endpoint (User avatar, Group/Section profile
 * image, Event cover - module spec §21/§22). Contains no domain knowledge
 * of its own (no field names, no entity types) - each caller supplies its
 * own `persist` closure, keeping this class a pure, reusable choreography
 * of R2 + a caller-supplied DB write, testable exactly once.
 */
@Injectable()
export class ImageAssetService {
  private readonly logger = new Logger(ImageAssetService.name);

  constructor(private readonly storage: R2StorageService) {}

  /**
   * Order matters (module spec §21):
   *   1. upload the NEW object to R2 (throws IMAGE_UPLOAD_FAILED and stops
   *      here on failure - DB untouched, old object untouched)
   *   2. persist the new key (on failure, best-effort delete the orphaned
   *      new object, then rethrow - DB unchanged, old object still the
   *      live one)
   *   3. only once persist has committed, best-effort delete the OLD
   *      object - a failure here is logged, never thrown; the request has
   *      already succeeded and the old object is now a pure orphan (no
   *      cleanup job in this task - module spec §40)
   */
  async replace(params: ReplaceImageParams): Promise<void> {
    await this.storage.putObject(
      params.newKey,
      params.processedBuffer,
      IMAGE_OUTPUT_CONTENT_TYPE,
    );

    try {
      await params.persist(params.newKey);
    } catch (error) {
      await this.cleanupOrphan(
        params.newKey,
        params.logContext,
        'orphaned new object after a failed DB write',
      );
      throw error;
    }

    if (params.oldKey) {
      await this.cleanupOrphan(
        params.oldKey,
        params.logContext,
        'stale object after a successful replace',
      );
    }
  }

  /**
   * Idempotent when there is nothing to delete (module spec §42 - "Preferuj
   * idempotent DELETE"): `persist` is never even called in that case, so a
   * second DELETE in a row is a pure no-op success, not a second flush.
   * Otherwise, DB first (module spec §22 - "ustaw key = null w DB" before
   * touching R2), then best-effort delete the R2 object; a delete failure
   * is logged, never thrown - the DB is already correctly cleared, so the
   * request still succeeds.
   */
  async remove(params: RemoveImageParams): Promise<void> {
    if (!params.oldKey) {
      return;
    }
    await params.persist();
    await this.cleanupOrphan(
      params.oldKey,
      params.logContext,
      'deleted image removed from R2',
    );
  }

  /**
   * Best-effort delete of an object this resource no longer references -
   * logged on failure, never thrown (module spec §21/§40/§41). Public (not
   * just an internal step of replace/remove above) for the User avatar
   * type-switch flows (PRESET / CLERK - see UserService.setAvatarPreset/
   * resetAvatarToClerk), which always persist unconditionally (unlike
   * `remove` above, switching type is a real state change even when there
   * was no uploaded image to clean up) and only conditionally have an old
   * R2 object to clean up afterwards.
   */
  async cleanupOrphan(
    key: string | null,
    logContext: Record<string, string>,
    reason: string,
  ): Promise<void> {
    if (!key) {
      return;
    }
    try {
      await this.storage.deleteObject(key);
    } catch (error) {
      this.logger.error(
        `R2 cleanup failed (${reason}): key=${key} context=${JSON.stringify(logContext)} error=${(error as Error).message}`,
      );
    }
  }
}
