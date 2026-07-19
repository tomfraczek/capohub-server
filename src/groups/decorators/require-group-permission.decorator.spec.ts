import { Reflector } from '@nestjs/core';
import { GroupPermission } from '../permissions/group-permission.enum';
import {
  GROUP_PERMISSIONS_KEY,
  RequireGroupPermission,
} from './require-group-permission.decorator';

describe('RequireGroupPermission', () => {
  it('sets the group permissions metadata to the given list', () => {
    class TestController {
      @RequireGroupPermission(
        GroupPermission.GROUP_EDIT,
        GroupPermission.GROUP_VIEW,
      )
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<GroupPermission[]>(
      GROUP_PERMISSIONS_KEY,
      handlerRef,
    );

    expect(metadata).toEqual([
      GroupPermission.GROUP_EDIT,
      GroupPermission.GROUP_VIEW,
    ]);
  });

  it('supports an empty permission list', () => {
    class TestController {
      @RequireGroupPermission()
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<GroupPermission[]>(
      GROUP_PERMISSIONS_KEY,
      handlerRef,
    );

    expect(metadata).toEqual([]);
  });
});
