// Shared across every image upload endpoint (User avatar, Group/Section
// profile image, Event cover) - see storage module spec §8/§7. One limit,
// one allowed-format set for all four, since nothing about them differs
// enough to warrant per-resource tuning.

// 10 MB, measured on the raw upload before any resize/decode - see
// multer-image.interceptor.ts, which enforces this at the multipart-parsing
// layer so an oversized file is rejected before Sharp ever touches it.
export const MAX_IMAGE_UPLOAD_BYTES = 10 * 1024 * 1024;

// Deliberately narrow and client-mimetype-driven only for the *fast* first
// filter (multer's fileFilter, see multer-image.interceptor.ts) - the
// actual authority on "is this really an image" is Sharp attempting to
// decode the bytes (see image-processing.service.ts), never the client-
// supplied Content-Type alone (module spec §9: a renamed .exe must not
// pass just because the client claims image/jpeg). SVG and HEIC/HEIF are
// deliberately excluded - see the module spec §7.
export const ALLOWED_IMAGE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedImageMimeType = (typeof ALLOWED_IMAGE_MIME_TYPES)[number];

export function isAllowedImageMimeType(
  mimetype: string,
): mimetype is AllowedImageMimeType {
  return (ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimetype);
}

// Every object this module ever writes to R2 is re-encoded to WebP - see
// image-processing.service.ts. Never the original JPEG/PNG bytes.
export const IMAGE_OUTPUT_CONTENT_TYPE = 'image/webp';

// Square, cover-cropped - User avatar, Group profile image, Section
// profile image (module spec §6). Event cover uses its own 16:9 shape,
// see EVENT_COVER_DIMENSIONS below.
export const PROFILE_IMAGE_DIMENSIONS = { width: 512, height: 512 } as const;

export const EVENT_COVER_DIMENSIONS = { width: 1600, height: 900 } as const;

// 82-85 per the module spec ("quality około 82-85") - a single fixed value
// rather than a per-resource range, since nothing here calls for tuning it
// differently per resource type.
export const IMAGE_OUTPUT_QUALITY = 82;

// Immutable - a fresh UUID object key is minted on every upload (see
// object-keys.util.ts), so the same URL is never asked to represent two
// different images (module spec §31).
export const IMAGE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
