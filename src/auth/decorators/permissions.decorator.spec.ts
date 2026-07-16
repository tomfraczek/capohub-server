import { Reflector } from '@nestjs/core';
import { Permission } from '../permissions/permission.enum';
import { Permissions, PERMISSIONS_KEY } from './permissions.decorator';

describe('Permissions', () => {
  it('sets the permissions metadata to the given list', () => {
    class TestController {
      @Permissions(Permission.SONG_CREATE, Permission.SONG_EDIT_OWN)
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef);

    expect(metadata).toEqual([
      Permission.SONG_CREATE,
      Permission.SONG_EDIT_OWN,
    ]);
  });

  it('supports an empty permission list', () => {
    class TestController {
      @Permissions()
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<Permission[]>(PERMISSIONS_KEY, handlerRef);

    expect(metadata).toEqual([]);
  });
});
