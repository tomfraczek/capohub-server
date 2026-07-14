import { Provider } from '@nestjs/common';
import { verifyToken } from '@clerk/backend';

/**
 * The only place in the project that imports @clerk/backend's verifyToken.
 * Injected by token so tests can substitute a mock without hitting Clerk.
 */
export const CLERK_VERIFY_TOKEN = Symbol('CLERK_VERIFY_TOKEN');

export type ClerkVerifyToken = typeof verifyToken;

export const clerkVerifyTokenProvider: Provider = {
  provide: CLERK_VERIFY_TOKEN,
  useValue: verifyToken,
};
