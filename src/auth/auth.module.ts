import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { UsersModule } from '../users/users.module';
import { AuthController } from './auth.controller';
import { ClerkAuthService } from './clerk/clerk-auth.service';
import { ClerkModule } from './clerk/clerk.module';
import { ClerkAuthGuard } from './guards/clerk-auth.guard';

@Module({
  imports: [ClerkModule, UsersModule],
  controllers: [AuthController],
  providers: [
    ClerkAuthService,
    {
      provide: APP_GUARD,
      useClass: ClerkAuthGuard,
    },
  ],
  exports: [ClerkAuthService],
})
export class AuthModule {}
