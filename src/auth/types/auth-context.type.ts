export type SessionTokenType = 'session_token';

export interface AuthContext {
  userId: string;
  sessionId: string;
  tokenType: SessionTokenType;
  claims: {
    sub: string;
    sid: string;
    [key: string]: unknown;
  };
}
