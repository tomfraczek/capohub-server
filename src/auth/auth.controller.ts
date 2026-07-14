import { Controller, Get } from '@nestjs/common';
import { CurrentAuth } from './decorators/current-auth.decorator';
import type { AuthContext } from './types/auth-context.type';

interface SessionResponse {
  authenticated: true;
  userId: string;
  sessionId: string;
}

@Controller('auth')
export class AuthController {
  @Get('session')
  getSession(@CurrentAuth() auth: AuthContext): SessionResponse {
    return {
      authenticated: true,
      userId: auth.userId,
      sessionId: auth.sessionId,
    };
  }
}
