import { Request } from 'express';
import type { User } from '../../users/entities/user.entity';
import { AuthContext } from './auth-context.type';

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
  localUser: User;
}
