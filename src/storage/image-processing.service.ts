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
  async processProfileImage(buffer: Buffer): Promise<Buffer> {
    return this.process(buffer, PROFILE_IMAGE_DIMENSIONS);
  }

  // Shared by Event cover and Group cover uploads (the name predates
  // Group's own cover upload, see events.service.ts/groups.service.ts) -
  // both use the same 16:9 COVER_IMAGE_DIMENSIONS shape.
  async processCoverImage(buffer: Buffer): Promise<Buffer> {
    return this.process(buffer, COVER_IMAGE_DIMENSIONS);
  }

  private async process(
    buffer: Buffer,
    dimensions: { width: number; height: number },
  ): Promise<Buffer> {
    try {
      return await sharp(buffer)
        // Applies EXIF orientation before crop - otherwise a portrait
        // photo taken on a phone can crop to the wrong region once its
        // orientation tag is dropped by the resize below.
        .rotate()
        .resize(dimensions.width, dimensions.height, {
          fit: 'cover',
          position: 'centre',
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
