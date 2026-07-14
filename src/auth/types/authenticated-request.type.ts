import { Request } from 'express';
import { AuthContext } from './auth-context.type';

export interface AuthenticatedRequest extends Request {
  auth: AuthContext;
}
