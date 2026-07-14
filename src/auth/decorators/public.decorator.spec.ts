import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from './public.decorator';

describe('Public', () => {
  it('sets the isPublic metadata to true', () => {
    class TestController {
      @Public()
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<boolean>(IS_PUBLIC_KEY, handlerRef);

    expect(metadata).toBe(true);
  });
});
