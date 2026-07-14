import { validateEnv } from './env.schema';

const VALID_DATABASE_URL =
  'postgresql://user:password@localhost:5432/capoeira_hub';

describe('validateEnv', () => {
  it('parses a fully specified valid configuration', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      API_PREFIX: 'api',
      API_VERSION: 'v2',
      CORS_ORIGINS: 'https://example.com, https://foo.com',
      DATABASE_URL: VALID_DATABASE_URL,
      DATABASE_SSL: 'true',
    });

    expect(result).toEqual({
      NODE_ENV: 'production',
      PORT: 4000,
      API_PREFIX: 'api',
      API_VERSION: 'v2',
      CORS_ORIGINS: ['https://example.com', 'https://foo.com'],
      DATABASE_URL: VALID_DATABASE_URL,
      DATABASE_SSL: true,
    });
  });

  it('applies defaults when optional variables are missing', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
    });

    expect(result).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      API_VERSION: 'v1',
      DATABASE_SSL: false,
    });
  });

  it('trims whitespace and drops empty entries from CORS_ORIGINS', () => {
    const result = validateEnv({
      CORS_ORIGINS: ' http://localhost:3000 ,, http://localhost:8081 ,',
      DATABASE_URL: VALID_DATABASE_URL,
    });

    expect(result.CORS_ORIGINS).toEqual([
      'http://localhost:3000',
      'http://localhost:8081',
    ]);
  });

  it('allows an empty CORS_ORIGINS only in the test environment', () => {
    const result = validateEnv({
      NODE_ENV: 'test',
      CORS_ORIGINS: '',
      DATABASE_URL: VALID_DATABASE_URL,
    });
    expect(result.CORS_ORIGINS).toEqual([]);
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'staging',
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a non-positive PORT value', () => {
    expect(() =>
      validateEnv({
        PORT: '-1',
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an empty CORS_ORIGINS outside of the test environment', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        CORS_ORIGINS: '',
        DATABASE_URL: VALID_DATABASE_URL,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('accepts a postgres:// DATABASE_URL', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: 'postgres://user:password@localhost:5432/capoeira_hub',
    });

    expect(result.DATABASE_URL).toBe(
      'postgres://user:password@localhost:5432/capoeira_hub',
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      validateEnv({ CORS_ORIGINS: 'http://localhost:3000' }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a DATABASE_URL with an unsupported protocol', () => {
    expect(() =>
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: 'mysql://user:password@localhost:3306/capoeira_hub',
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('does not leak the DATABASE_URL value in the error message for an invalid protocol', () => {
    try {
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: 'mysql://user:supersecret@localhost:3306/capoeira_hub',
      });
      throw new Error('expected validateEnv to throw');
    } catch (error) {
      expect((error as Error).message).not.toContain('supersecret');
    }
  });

  it('parses DATABASE_SSL=true', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
      DATABASE_SSL: 'true',
    });
    expect(result.DATABASE_SSL).toBe(true);
  });

  it('parses DATABASE_SSL=false', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
      DATABASE_SSL: 'false',
    });
    expect(result.DATABASE_SSL).toBe(false);
  });

  it('defaults DATABASE_SSL to false when not provided', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
    });
    expect(result.DATABASE_SSL).toBe(false);
  });

  it('rejects an invalid DATABASE_SSL value', () => {
    expect(() =>
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        DATABASE_SSL: 'yes',
      }),
    ).toThrow(/Invalid environment configuration/);
  });
});
