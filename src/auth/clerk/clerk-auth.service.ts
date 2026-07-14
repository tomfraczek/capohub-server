import {
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { AppConfigService } from '../../config/app.config';
import { AuthContext } from '../types/auth-context.type';
import { CLERK_VERIFY_TOKEN } from './clerk-verify-token.provider';
import type { ClerkVerifyToken } from './clerk-verify-token.provider';

/**
 * Verifies Clerk session tokens and produces the internal AuthContext.
 * The only consumer of ClerkVerifyToken - callers never see the raw Clerk
 * SDK errors or payload, only a plain AuthContext or a 401.
 */
@Injectable()
export class ClerkAuthService {
  private readonly logger = new Logger(ClerkAuthService.name);

  constructor(
    @Inject(CLERK_VERIFY_TOKEN)
    private readonly verifyToken: ClerkVerifyToken,
    private readonly appConfig: AppConfigService,
  ) {}

  async verifySessionToken(token: string): Promise<AuthContext> {
    try {
      const jwtKey = this.appConfig.clerkJwtKey;
      const authorizedParties = this.appConfig.clerkAuthorizedParties;

      const claims = await this.verifyToken(token, {
        secretKey: this.appConfig.clerkSecretKey,
        ...(jwtKey ? { jwtKey } : {}),
        ...(authorizedParties.length > 0 ? { authorizedParties } : {}),
      });

      if (!claims.sub || !claims.sid) {
        throw new Error('Session token is missing required claims');
      }

      const safeClaims: Record<string, unknown> = { ...claims };
      delete safeClaims.__raw;

      return {
        userId: claims.sub,
        sessionId: claims.sid,
        tokenType: 'session_token',
        claims: safeClaims as AuthContext['claims'],
      };
    } catch (error) {
      this.logger.warn(
        `Session token rejected: ${this.describeFailure(error)}`,
      );
      throw new UnauthorizedException('Authentication required');
    }
  }

  private describeFailure(error: unknown): string {
    return error instanceof Error ? error.message : 'unknown error';
  }
}
