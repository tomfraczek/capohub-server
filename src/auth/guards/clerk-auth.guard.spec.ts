import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { UserService } from '../../users/user.service';
import { ClerkAuthService } from '../clerk/clerk-auth.service';
import { AuthContext } from '../types/auth-context.type';
import { ClerkAuthGuard } from './clerk-auth.guard';

interface FakeUser {
  id: string;
  clerkUserId: string;
}

describe('ClerkAuthGuard', () => {
  const sampleAuth: AuthContext = {
    userId: 'user_123',
    sessionId: 'sess_123',
    tokenType: 'session_token',
    claims: { sub: 'user_123', sid: 'sess_123' },
  };

  const sampleUser: FakeUser = { id: 'local-uuid-1', clerkUserId: 'user_123' };

  function buildContext(authorizationHeader: string | undefined): {
    context: ExecutionContext;
    request: {
      headers: Record<string, string | undefined>;
      auth?: AuthContext;
      localUser?: FakeUser;
    };
  } {
    const request: {
      headers: Record<string, string | undefined>;
      auth?: AuthContext;
      localUser?: FakeUser;
    } = {
      headers: { authorization: authorizationHeader },
    };

    const context = {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as unknown as ExecutionContext;

    return { context, request };
  }

  function buildGuard(options: {
    isPublic?: boolean;
    verifySessionToken?: jest.Mock;
    findOrCreateFromClerk?: jest.Mock;
  }): ClerkAuthGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(options.isPublic ?? false),
    } as unknown as Reflector;

    const clerkAuthService = {
      verifySessionToken:
        options.verifySessionToken ?? jest.fn().mockResolvedValue(sampleAuth),
    } as unknown as ClerkAuthService;

    const userService = {
      findOrCreateFromClerk:
        options.findOrCreateFromClerk ??
        jest.fn().mockResolvedValue(sampleUser),
    } as unknown as UserService;

    return new ClerkAuthGuard(reflector, clerkAuthService, userService);
  }

  it('allows a @Public() route without checking the header', async () => {
    const guard = buildGuard({ isPublic: true });
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('rejects a request with no Authorization header', async () => {
    const guard = buildGuard({});
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an empty Authorization header', async () => {
    const guard = buildGuard({});
    const { context } = buildContext('');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a Basic scheme', async () => {
    const guard = buildGuard({});
    const { context } = buildContext('Basic dXNlcjpwYXNz');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects "Bearer" with no token', async () => {
    const guard = buildGuard({});
    const { context } = buildContext('Bearer');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects "Bearer " with an empty token', async () => {
    const guard = buildGuard({});
    const { context } = buildContext('Bearer   ');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects multiple token fragments after Bearer', async () => {
    const guard = buildGuard({});
    const { context } = buildContext('Bearer token1 token2');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('accepts a lowercase "bearer" scheme', async () => {
    const verifySessionToken = jest.fn().mockResolvedValue(sampleAuth);
    const guard = buildGuard({ verifySessionToken });
    const { context, request } = buildContext('bearer valid-token');

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(verifySessionToken).toHaveBeenCalledWith('valid-token');
    expect(request.auth).toEqual(sampleAuth);
  });

  it('attaches the verified AuthContext to the request on success', async () => {
    const guard = buildGuard({});
    const { context, request } = buildContext('Bearer valid-token');

    await guard.canActivate(context);

    expect(request.auth).toEqual(sampleAuth);
  });

  it('syncs and attaches the local User to the request on success', async () => {
    const findOrCreateFromClerk = jest.fn().mockResolvedValue(sampleUser);
    const guard = buildGuard({ findOrCreateFromClerk });
    const { context, request } = buildContext('Bearer valid-token');

    await guard.canActivate(context);

    expect(findOrCreateFromClerk).toHaveBeenCalledWith(sampleAuth);
    expect(request.localUser).toEqual(sampleUser);
  });

  it('does not sync the user when the request is unauthenticated', async () => {
    const findOrCreateFromClerk = jest.fn();
    const guard = buildGuard({ findOrCreateFromClerk });
    const { context } = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(findOrCreateFromClerk).not.toHaveBeenCalled();
  });

  it('propagates a 401 when ClerkAuthService rejects the token', async () => {
    const verifySessionToken = jest
      .fn()
      .mockRejectedValue(new UnauthorizedException('Authentication required'));
    const guard = buildGuard({ verifySessionToken });
    const { context } = buildContext('Bearer invalid-token');

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('never includes the token in the thrown error message', async () => {
    const guard = buildGuard({});
    const { context } = buildContext(undefined);

    try {
      await guard.canActivate(context);
      throw new Error('expected canActivate to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('Bearer');
    }
  });

  it('respects @Public() metadata read from both handler and class', async () => {
    const getAllAndOverride = jest.fn().mockReturnValue(true);
    const reflector = { getAllAndOverride } as unknown as Reflector;
    const clerkAuthService = {
      verifySessionToken: jest.fn(),
    } as unknown as ClerkAuthService;
    const userService = {
      findOrCreateFromClerk: jest.fn(),
    } as unknown as UserService;
    const guard = new ClerkAuthGuard(reflector, clerkAuthService, userService);
    const { context } = buildContext(undefined);

    await guard.canActivate(context);

    expect(getAllAndOverride).toHaveBeenCalledWith(expect.any(String), [
      expect.anything(),
      expect.anything(),
    ]);
  });
});
