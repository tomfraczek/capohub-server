import { Module } from '@nestjs/common';
import { CLERK_CLIENT, clerkClientProvider } from './clerk-client.provider';
import {
  CLERK_VERIFY_TOKEN,
  clerkVerifyTokenProvider,
} from './clerk-verify-token.provider';

/**
 * Shared leaf module for Clerk SDK access, imported by both AuthModule
 * (token verification) and UsersModule (profile lookups) so neither has to
 * depend on the other just to reach the Clerk SDK.
 */
@Module({
  providers: [clerkVerifyTokenProvider, clerkClientProvider],
  exports: [CLERK_VERIFY_TOKEN, CLERK_CLIENT],
})
export class ClerkModule {}
