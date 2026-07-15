import { Provider } from '@nestjs/common';
import { ClerkClient, createClerkClient } from '@clerk/backend';
import { AppConfigService } from '../../config/app.config';

/**
 * The only place in the project that calls createClerkClient(). Needed for
 * Backend API calls (e.g. fetching a user profile) that verifyToken() alone
 * cannot provide - session tokens don't carry email/name/image claims.
 */
export const CLERK_CLIENT = Symbol('CLERK_CLIENT');

export const clerkClientProvider: Provider = {
  provide: CLERK_CLIENT,
  inject: [AppConfigService],
  useFactory: (appConfig: AppConfigService): ClerkClient =>
    createClerkClient({
      secretKey: appConfig.clerkSecretKey,
      publishableKey: appConfig.clerkPublishableKey,
    }),
};
