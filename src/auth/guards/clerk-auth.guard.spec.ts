import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ClerkAuthService } from '../clerk/clerk-auth.service';
import { AuthContext } from '../types/auth-context.type';
import { ClerkAuthGuard } from './clerk-auth.guard';

describe('ClerkAuthGuard', () => {
  const sampleAuth: AuthContext = {
    userId: 'user_123',
    sessionId: 'sess_123',
    tokenType: 'session_token',
    claims: { sub: 'user_123', sid: 'sess_123' },
  };

  function buildContext(authorizationHeader: string | undefined): {
    context: ExecutionContext;
    request: {
      headers: Record<string, string | undefined>;
      auth?: AuthContext;
    };
  } {
    const request: {
      headers: Record<string, string | undefined>;
      auth?: AuthContext;
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
  }): ClerkAuthGuard {
    const reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(options.isPublic ?? false),
    } as unknown as Reflector;

    const clerkAuthService = {
      verifySessionToken:
        options.verifySessionToken ?? jest.fn().mockResolvedValue(sampleAuth),
    } as unknown as ClerkAuthService;

    return new ClerkAuthGuard(reflector, clerkAuthService);
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
    const guard = new ClerkAuthGuard(reflector, clerkAuthService);
    const { context } = buildContext(undefined);

    await guard.canActivate(context);

    expect(getAllAndOverride).toHaveBeenCalledWith(expect.any(String), [
      expect.anything(),
      expect.anything(),
    ]);
  });
});
