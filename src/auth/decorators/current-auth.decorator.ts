import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthContext } from '../types/auth-context.type';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

// Exported separately so it can be unit tested without going through
// Nest's param-decorator factory machinery.
export function getCurrentAuth(
  _data: unknown,
  context: ExecutionContext,
): AuthContext {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.auth;
}

/**
 * Returns the AuthContext attached to the request by ClerkAuthGuard.
 * Only meaningful on routes protected by the guard (i.e. not @Public()).
 */
export const CurrentAuth = createParamDecorator(getCurrentAuth);
