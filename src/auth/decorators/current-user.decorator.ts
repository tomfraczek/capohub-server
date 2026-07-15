import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { User } from '../../users/entities/user.entity';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

// Exported separately so it can be unit tested without going through
// Nest's param-decorator factory machinery.
export function getCurrentUser(
  _data: unknown,
  context: ExecutionContext,
): User {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  return request.localUser;
}

/**
 * Returns the local User entity synced by ClerkAuthGuard. Only meaningful
 * on routes protected by the guard (i.e. not @Public()).
 */
export const CurrentUser = createParamDecorator(getCurrentUser);
