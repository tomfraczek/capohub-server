import {
  assertImageFilePresent,
  imageMimeFileFilter,
} from './multer-image.interceptor';

function buildFile(mimetype: string): Express.Multer.File {
  return { mimetype } as Express.Multer.File;
}

// Explicitly typed (not a bare `jest.fn()`) so `.mock.calls[0]` below
// destructures to `[Error | null, boolean]` rather than `any`.
function buildCallback(): jest.Mock<void, [Error | null, boolean]> {
  return jest.fn<void, [Error | null, boolean]>();
}

describe('imageMimeFileFilter', () => {
  it.each(['image/jpeg', 'image/png', 'image/webp'])(
    'accepts %s',
    (mimetype) => {
      const callback = buildCallback();

      imageMimeFileFilter(undefined, buildFile(mimetype), callback);

      expect(callback).toHaveBeenCalledWith(null, true);
    },
  );

  it.each(['application/pdf', 'image/svg+xml', 'image/heic', 'text/plain'])(
    'rejects %s with IMAGE_UNSUPPORTED_TYPE, never a bare boolean reject',
    (mimetype) => {
      const callback = buildCallback();

      imageMimeFileFilter(undefined, buildFile(mimetype), callback);

      expect(callback).toHaveBeenCalledTimes(1);
      const [error, accepted] = callback.mock.calls[0];
      expect(accepted).toBe(false);
      expect(error).toMatchObject({
        response: { code: 'IMAGE_UNSUPPORTED_TYPE' },
      });
    },
  );

  it('rejects a spoofed image/jpeg claim from a client just as readily as an honest wrong mimetype', () => {
    // fileFilter is a fast pre-check only (see the interceptor's own
    // comment) - it has no way to know the bytes are actually a PDF, but
    // this test documents that boundary: a client claiming image/jpeg
    // always passes this layer regardless of its real content, and only
    // ImageProcessingService (Sharp decode) can catch a mislabeled file -
    // see image-processing.service.spec.ts's IMAGE_INVALID coverage.
    const callback = buildCallback();

    imageMimeFileFilter(undefined, buildFile('image/jpeg'), callback);

    expect(callback).toHaveBeenCalledWith(null, true);
  });
});

describe('assertImageFilePresent', () => {
  it('throws IMAGE_REQUIRED when no file was attached', () => {
    let caught: unknown;
    try {
      assertImageFilePresent(undefined);
    } catch (error) {
      caught = error;
    }

    expect(caught).toMatchObject({
      response: {
        code: 'IMAGE_REQUIRED',
        message: 'An image file is required',
      },
    });
  });

  it('does not throw when a file is present', () => {
    expect(() => assertImageFilePresent(buildFile('image/jpeg'))).not.toThrow();
  });
});
