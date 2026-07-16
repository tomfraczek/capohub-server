import { AuthController } from './auth.controller';
import { GlobalRole } from './permissions/global-role.enum';
import type { AuthContext } from './types/auth-context.type';
import type { User } from '../users/entities/user.entity';

describe('AuthController', () => {
  describe('getSession', () => {
    it('returns the authenticated session info from AuthContext', () => {
      const controller = new AuthController();
      const auth: AuthContext = {
        userId: 'user_1',
        sessionId: 'sess_1',
        tokenType: 'session_token',
        claims: { sub: 'user_1', sid: 'sess_1' },
      };

      expect(controller.getSession(auth)).toEqual({
        authenticated: true,
        userId: 'user_1',
        sessionId: 'sess_1',
      });
    });
  });

  describe('getPermissionsTest', () => {
    it('returns ok and the current user globalRole', () => {
      const controller = new AuthController();
      const user = { globalRole: GlobalRole.ADMIN } as User;

      expect(controller.getPermissionsTest(user)).toEqual({
        ok: true,
        globalRole: GlobalRole.ADMIN,
      });
    });
  });
});
