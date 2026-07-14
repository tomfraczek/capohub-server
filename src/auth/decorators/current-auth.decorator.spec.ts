import { ExecutionContext } from '@nestjs/common';
import { AuthContext } from '../types/auth-context.type';
import { getCurrentAuth } from './current-auth.decorator';

describe('CurrentAuth', () => {
  function buildContext(auth: AuthContext | undefined): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ auth }),
      }),
    } as unknown as ExecutionContext;
  }

  it('returns the AuthContext attached to the request', () => {
    const auth: AuthContext = {
      userId: 'user_123',
      sessionId: 'sess_123',
      tokenType: 'session_token',
      claims: { sub: 'user_123', sid: 'sess_123' },
    };

    expect(getCurrentAuth(undefined, buildContext(auth))).toEqual(auth);
  });

  it('returns undefined without throwing when the request has no auth', () => {
    expect(() =>
      getCurrentAuth(undefined, buildContext(undefined)),
    ).not.toThrow();
    expect(getCurrentAuth(undefined, buildContext(undefined))).toBeUndefined();
  });
});
