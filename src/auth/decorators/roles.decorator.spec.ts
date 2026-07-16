import { Reflector } from '@nestjs/core';
import { GlobalRole } from '../permissions/global-role.enum';
import { Roles, ROLES_KEY } from './roles.decorator';

describe('Roles', () => {
  it('sets the roles metadata to the given list', () => {
    class TestController {
      @Roles(GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN)
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<GlobalRole[]>(ROLES_KEY, handlerRef);

    expect(metadata).toEqual([GlobalRole.ADMIN, GlobalRole.SUPER_ADMIN]);
  });

  it('supports an empty role list', () => {
    class TestController {
      @Roles()
      handler(): void {}
    }

    const reflector = new Reflector();
    // eslint-disable-next-line @typescript-eslint/unbound-method -- used only as a metadata target, never invoked
    const handlerRef = new TestController().handler;
    const metadata = reflector.get<GlobalRole[]>(ROLES_KEY, handlerRef);

    expect(metadata).toEqual([]);
  });
});
