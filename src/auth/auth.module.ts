import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { ClerkAuthService } from './clerk/clerk-auth.service';
import { clerkVerifyTokenProvider } from './clerk/clerk-verify-token.provider';
import { ClerkAuthGuard } from './guards/clerk-auth.guard';

@Module({
  controllers: [AuthController],
  providers: [
    clerkVerifyTokenProvider,
    ClerkAuthService,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
  ],
  exports: [ClerkAuthService],
})
export class AuthModule {}
