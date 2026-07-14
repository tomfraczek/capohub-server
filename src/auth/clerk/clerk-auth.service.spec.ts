import { UnauthorizedException } from '@nestjs/common';
import { AppConfigService } from '../../config/app.config';
import { ClerkAuthService } from './clerk-auth.service';
import type { ClerkVerifyToken } from './clerk-verify-token.provider';

describe('ClerkAuthService', () => {
  const buildAppConfig = (
    overrides: Partial<{
      clerkSecretKey: string;
      clerkJwtKey: string | undefined;
      clerkAuthorizedParties: string[];
    }> = {},
  ): AppConfigService =>
    ({
      clerkSecretKey: 'sk_test_abc',
      clerkJwtKey: undefined,
      clerkAuthorizedParties: [],
      ...overrides,
    }) as unknown as AppConfigService;

  const buildService = (
    verifyToken: ClerkVerifyToken,
    appConfig: AppConfigService = buildAppConfig(),
  ): ClerkAuthService => new ClerkAuthService(verifyToken, appConfig);

  type VerifyTokenArgs = [token: string, options: Record<string, unknown>];

  it('returns an AuthContext for a valid session token', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sub: 'user_123',
      sid: 'sess_123',
      iss: 'https://example.clerk.accounts.dev',
      exp: 1234567890,
    }) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);
    const result = await service.verifySessionToken('valid-token');

    expect(result).toEqual({
      userId: 'user_123',
      sessionId: 'sess_123',
      tokenType: 'session_token',
      claims: {
        sub: 'user_123',
        sid: 'sess_123',
        iss: 'https://example.clerk.accounts.dev',
        exp: 1234567890,
      },
    });
  });

  it('strips the raw token from the returned claims', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sub: 'user_123',
      sid: 'sess_123',
      __raw: 'the-actual-jwt-string',
    }) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);
    const result = await service.verifySessionToken('valid-token');

    expect(result.claims).not.toHaveProperty('__raw');
  });

  it('throws UnauthorizedException when userId (sub) is missing', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sid: 'sess_123',
    }) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);

    await expect(service.verifySessionToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws UnauthorizedException when sessionId (sid) is missing', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sub: 'user_123',
    }) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);

    await expect(service.verifySessionToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws a unified UnauthorizedException for an expired token', async () => {
    const verifyToken = jest
      .fn()
      .mockRejectedValue(
        new Error('JWT is expired'),
      ) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);

    await expect(service.verifySessionToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws a unified UnauthorizedException for an invalid signature', async () => {
    const verifyToken = jest
      .fn()
      .mockRejectedValue(
        new Error('Invalid signature'),
      ) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);

    await expect(service.verifySessionToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('throws a unified UnauthorizedException for an unknown SDK error', async () => {
    const verifyToken = jest
      .fn()
      .mockRejectedValue(
        'a non-Error rejection',
      ) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);

    await expect(service.verifySessionToken('token')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('never lets the raw error message leak into the thrown exception', async () => {
    const verifyToken = jest
      .fn()
      .mockRejectedValue(
        new Error('signature mismatch for kid abc123'),
      ) as unknown as ClerkVerifyToken;

    const service = buildService(verifyToken);

    try {
      await service.verifySessionToken('token');
      throw new Error('expected verifySessionToken to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(UnauthorizedException);
      expect((error as UnauthorizedException).message).toBe(
        'Authentication required',
      );
    }
  });

  it('passes authorizedParties to verifyToken when configured', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sub: 'user_123',
      sid: 'sess_123',
    }) as unknown as ClerkVerifyToken;

    const appConfig = buildAppConfig({
      clerkAuthorizedParties: ['http://localhost:8081'],
    });
    const service = buildService(verifyToken, appConfig);
    await service.verifySessionToken('token');

    expect(verifyToken).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({
        authorizedParties: ['http://localhost:8081'],
      }),
    );
  });

  it('does not pass authorizedParties to verifyToken when not configured', async () => {
    const mockFn = jest
      .fn<Promise<Record<string, unknown>>, VerifyTokenArgs>()
      .mockResolvedValue({ sub: 'user_123', sid: 'sess_123' });

    const service = buildService(mockFn as unknown as ClerkVerifyToken);
    await service.verifySessionToken('token');

    const options = mockFn.mock.calls[0][1];
    expect(options).not.toHaveProperty('authorizedParties');
  });

  it('passes jwtKey to verifyToken when configured', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sub: 'user_123',
      sid: 'sess_123',
    }) as unknown as ClerkVerifyToken;

    const appConfig = buildAppConfig({ clerkJwtKey: 'pem-key-contents' });
    const service = buildService(verifyToken, appConfig);
    await service.verifySessionToken('token');

    expect(verifyToken).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ jwtKey: 'pem-key-contents' }),
    );
  });

  it('does not pass jwtKey to verifyToken when not configured', async () => {
    const mockFn = jest
      .fn<Promise<Record<string, unknown>>, VerifyTokenArgs>()
      .mockResolvedValue({ sub: 'user_123', sid: 'sess_123' });

    const service = buildService(mockFn as unknown as ClerkVerifyToken);
    await service.verifySessionToken('token');

    const options = mockFn.mock.calls[0][1];
    expect(options).not.toHaveProperty('jwtKey');
  });

  it('always passes the configured secretKey to verifyToken', async () => {
    const verifyToken = jest.fn().mockResolvedValue({
      sub: 'user_123',
      sid: 'sess_123',
    }) as unknown as ClerkVerifyToken;

    const appConfig = buildAppConfig({ clerkSecretKey: 'sk_test_specific' });
    const service = buildService(verifyToken, appConfig);
    await service.verifySessionToken('token');

    expect(verifyToken).toHaveBeenCalledWith(
      'token',
      expect.objectContaining({ secretKey: 'sk_test_specific' }),
    );
  });
});
