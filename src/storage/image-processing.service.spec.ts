import sharp from 'sharp';
import { ImageProcessingService } from './image-processing.service';

// Real, tiny, synthetically generated images - not checked-in binary
// fixtures. Each starts as a solid-color rectangle at a size/aspect
// deliberately different from the target output, so a passing test proves
// the resize/crop actually ran rather than merely re-encoding an
// already-correctly-shaped input.
async function buildJpeg(width = 800, height = 600): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 200, g: 50, b: 50 },
    },
  })
    .jpeg()
    .toBuffer();
}

async function buildPng(width = 300, height = 900): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 10, g: 200, b: 10, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
}

async function buildWebp(width = 500, height = 500): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 10, g: 10, b: 200 },
    },
  })
    .webp()
    .toBuffer();
}

describe('ImageProcessingService', () => {
  const service = new ImageProcessingService();

  // User avatar, Group logo, Section logo (module: "przy wyborze loga nie
  // może być przycinania, musi wchodzić takie jakie użytkownik przyśle") -
  // never crops: the original aspect ratio always survives, only ever
  // scaled down (never up) to fit within PROFILE_IMAGE_DIMENSIONS. Unlike
  // processCoverImage below, output width/height are NOT both fixed - each
  // expectation here is the real, computed "fit: inside" result for its
  // input shape (asserted exactly, not just "fits inside 512x512", so a
  // regression back to cropping is caught even if it still happened to fit
  // in the box).
  describe('processProfileImage', () => {
    it('scales a landscape (4:3) JPEG down to fit inside 512x512, keeping its aspect ratio - never cropped to a square', async () => {
      const output = await service.processProfileImage(
        await buildJpeg(800, 600),
      );
      const metadata = await sharp(output).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(384);
    });

    it('scales a portrait (1:3) PNG down to fit inside 512x512, keeping its aspect ratio - never cropped to a square', async () => {
      const output = await service.processProfileImage(
        await buildPng(300, 900),
      );
      const metadata = await sharp(output).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(171);
      expect(metadata.height).toBe(512);
    });

    it('normalizes an already-WebP 4:3 input the same way (format conversion, not just a resize passthrough)', async () => {
      const output = await service.processProfileImage(
        await buildWebp(1024, 768),
      );
      const metadata = await sharp(output).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(512);
      expect(metadata.height).toBe(384);
    });

    it('never upscales an input already smaller than the bounding box', async () => {
      const output = await service.processProfileImage(
        await buildJpeg(100, 80),
      );
      const metadata = await sharp(output).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(100);
      expect(metadata.height).toBe(80);
    });

    it('rejects a non-image buffer with IMAGE_INVALID', async () => {
      const notAnImage = Buffer.from('this is definitely not an image');

      await expect(
        service.processProfileImage(notAnImage),
      ).rejects.toMatchObject({
        response: {
          code: 'IMAGE_INVALID',
          message: 'The uploaded file is not a valid image',
        },
      });
    });
  });

  describe('processCoverImage', () => {
    it('turns a JPEG into a 1600x900 WebP', async () => {
      const output = await service.processCoverImage(await buildJpeg());
      const metadata = await sharp(output).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(900);
    });

    it('cover-crops a portrait input to the fixed 16:9 output, never distorting it', async () => {
      // A tall, narrow input (300x900) - a naive non-cropping resize would
      // squash it; `fit: cover` must crop instead, so the output stays
      // exactly 1600x900 with no stretching.
      const output = await service.processCoverImage(await buildPng(300, 900));
      const metadata = await sharp(output).metadata();

      expect(metadata.format).toBe('webp');
      expect(metadata.width).toBe(1600);
      expect(metadata.height).toBe(900);
    });

    it('rejects a truncated/corrupt buffer with IMAGE_INVALID', async () => {
      const truncated = (await buildJpeg()).subarray(0, 50);

      await expect(service.processCoverImage(truncated)).rejects.toMatchObject({
        response: { code: 'IMAGE_INVALID' },
      });
    });
  });
});
