import { BadRequestException, Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import {
  MAX_IMAGE_UPLOAD_BYTES,
  isAllowedImageMimeType,
} from './image-upload.constants';

// Deliberately not multer's own `FileFilterCallback` type (its two-overload
// shape - `(error: Error)` OR `(error: null, acceptFile: boolean)` - is
// incompatible with the always-two-args callback type
// @nestjs/platform-express's MulterOptions actually declares for
// `fileFilter`). This matches Nest's shape so imageMimeFileFilter below can
// be assigned directly to `fileFilter` in imageUploadInterceptor.
type FileFilterCallback = (error: Error | null, acceptFile: boolean) => void;

/**
 * Extracted from imageUploadInterceptor below purely so it is directly
 * unit-testable without going through Nest's FileInterceptor mixin (which
 * exposes no way to invoke the multer config it builds internally) - module
 * spec §34/§7. Rejects an obviously-wrong claimed Content-Type - never the
 * authority on "is this really an image" (see imageUploadInterceptor's own
 * comment).
 */
export function imageMimeFileFilter(
  _req: unknown,
  file: Express.Multer.File,
  callback: FileFilterCallback,
): void {
  if (!isAllowedImageMimeType(file.mimetype)) {
    callback(
      new BadRequestException({
        code: 'IMAGE_UNSUPPORTED_TYPE',
        message: `Unsupported image type: ${file.mimetype}. Allowed: image/jpeg, image/png, image/webp.`,
      }),
      false,
    );
    return;
  }
  callback(null, true);
}

/**
 * Shared multer config for every image upload endpoint (User avatar,
 * Group/Section profile image, Event cover - module spec §16). Buffers to
 * memory, never disk - every uploaded file here is small (10 MB cap) and
 * short-lived (processed by Sharp and discarded within the same request),
 * so there is no reason to introduce a temp-file cleanup concern.
 *
 * `limits.fileSize` rejects an oversized file before Sharp ever sees it
 * (module spec §8) - multer aborts the stream and NestJS's own
 * FileInterceptor auto-converts that into a PayloadTooLargeException (see
 * common/filters/http-exception.filter.ts's IMAGE_TOO_LARGE fallback).
 *
 * `fileFilter` is a fast, client-mimetype-only pre-filter (module spec
 * §7/§34) - it exists to reject an obviously-wrong Content-Type (a PDF, an
 * SVG) before spending any time buffering the file at all, NOT as the
 * authority on "is this really an image" (module spec §9) - that
 * authority is Sharp actually attempting to decode the bytes, see
 * image-processing.service.ts, which runs after this interceptor and
 * rejects a mislabeled non-image (e.g. a renamed .exe claiming
 * image/jpeg) with IMAGE_INVALID.
 */
export function imageUploadInterceptor(fieldName = 'file'): Type<unknown> {
  return FileInterceptor(fieldName, {
    storage: memoryStorage(),
    limits: { fileSize: MAX_IMAGE_UPLOAD_BYTES, files: 1 },
    fileFilter: imageMimeFileFilter,
  });
}

/** Throws IMAGE_REQUIRED when the multipart request carried no `file` part
 * at all - multer leaves `req.file` (and so `@UploadedFile()`) undefined
 * in that case rather than raising an error of its own. */
export function assertImageFilePresent(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestException({
      code: 'IMAGE_REQUIRED',
      message: 'An image file is required',
    });
  }
}
