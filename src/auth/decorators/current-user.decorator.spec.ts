import { ExecutionContext } from '@nestjs/common';
import { getCurrentUser } from './current-user.decorator';

interface FakeUser {
  id: string;
  email: string;
}

describe('CurrentUser', () => {
  function buildContext(localUser: FakeUser | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ localUser }),
      }),
    } as unknown as ExecutionContext;
  }

  it('returns the local User attached to the request', () => {
    const user: FakeUser = { id: 'user-uuid-1', email: 'dev@example.com' };

    expect(getCurrentUser(undefined, buildContext(user))).toEqual(user);
  });

  it('returns undefined without throwing when the request has no local user', () => {
    expect(() =>
      getCurrentUser(undefined, buildContext(undefined)),
    ).not.toThrow();
    expect(getCurrentUser(undefined, buildContext(undefined))).toBeUndefined();
  });
});
