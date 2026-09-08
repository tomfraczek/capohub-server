import { BadRequestException, Injectable } from '@nestjs/common';
import sharp from 'sharp';
import {
  COVER_IMAGE_DIMENSIONS,
  IMAGE_OUTPUT_QUALITY,
  PROFILE_IMAGE_DIMENSIONS,
} from './image-upload.constants';

/**
 * Turns an arbitrary uploaded image buffer into this project's one
 * persisted shape for its kind - always WebP, always cover-cropped to a
 * fixed size, never the original bytes (module spec §6). Deliberately
 * separate from R2StorageService (module spec §13) - this class knows
 * nothing about object keys, buckets, or R2 at all, only pixels.
 *
 * Sharp is the actual authority on "is this really an image" (module spec
 * §9): `.toBuffer()` below must fully decode the input to resize/re-encode
 * it, so a file that merely claims to be a JPEG (a renamed executable, a
 * truncated/corrupt file) fails here with IMAGE_INVALID even though it
 * already passed multer's fileFilter mimetype pre-check (see
 * multer-image.interceptor.ts).
 */
@Injectable()
export class ImageProcessingService {
  // User avatar, Group logo, Section logo (module: "przy wyborze loga nie
  // może być przycinania, musi wchodzić takie jakie użytkownik przyśle") -
  // deliberately never crops: `fit: 'inside'` scales the whole original
  // image down until it fits within PROFILE_IMAGE_DIMENSIONS, keeping its
  // real aspect ratio and every pixel the user actually sent, unlike the
  // 'cover' fit this used before (which filled the square by cutting off
  // whatever didn't fit). `withoutEnlargement` skips scaling a
  // already-small image up, so a small square avatar is never blown up
  // into a blurry 512x512 either - the output stays whatever size actually
  // reflects the source, bounded only from above. Still always re-encoded
  // to WebP at IMAGE_OUTPUT_QUALITY, same as every other image this module
  // processes.
  async processProfileImage(buffer: Buffer): Promise<Buffer> {
    return this.process(buffer, PROFILE_IMAGE_DIMENSIONS, 'inside');
  }

  // Shared by Event cover and Group cover uploads (the name predates
  // Group's own cover upload, see events.service.ts/groups.service.ts) -
  // both use the same 16:9 COVER_IMAGE_DIMENSIONS shape, still cover-
  // cropped to that exact size (never asked to change - task only covers
  // Group/Section logo and User avatar, see processProfileImage above).
  async processCoverImage(buffer: Buffer): Promise<Buffer> {
    return this.process(buffer, COVER_IMAGE_DIMENSIONS, 'cover');
  }

  private async process(
    buffer: Buffer,
    dimensions: { width: number; height: number },
    fit: 'cover' | 'inside',
  ): Promise<Buffer> {
    try {
      return await sharp(buffer)
        // Applies EXIF orientation before resize - otherwise a portrait
        // photo taken on a phone can resize/crop against the wrong region
        // once its orientation tag is dropped by the resize below.
        .rotate()
        .resize(dimensions.width, dimensions.height, {
          fit,
          position: 'centre',
          withoutEnlargement: fit === 'inside',
        })
        .webp({ quality: IMAGE_OUTPUT_QUALITY })
        .toBuffer();
    } catch {
      // Never surface Sharp's raw decode error to the client (module spec
      // §42) - it can be a low-level libvips message that means nothing to
      // a mobile app user.
      throw new BadRequestException({
        code: 'IMAGE_INVALID',
        message: 'The uploaded file is not a valid image',
      });
    }
  }
}
