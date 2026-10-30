import { TEST_DATABASE_CA_CERT } from '../../test/database-ca-cert.fixture';
import { validateEnv } from './env.schema';

const VALID_DATABASE_URL =
  'postgresql://user:password@localhost:5432/capoeira_hub';
const PRODUCTION_DATABASE_URL =
  'postgresql://user:password@db-capohub.example.invalid:25060/defaultdb';
const VALID_CLERK_SECRET_KEY = 'sk_test_fixture_not_a_real_key_xyz';

describe('validateEnv', () => {
  it('parses a fully specified valid configuration', () => {
    const result = validateEnv({
      NODE_ENV: 'production',
      PORT: '4000',
      API_PREFIX: 'api',
      API_VERSION: 'v2',
      CORS_ORIGINS: 'https://example.com, https://foo.com',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      DATABASE_SSL: 'true',
      DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
      CLERK_SECRET_KEY: 'sk_live_fixture_not_a_real_key_xyz',
      CLERK_PUBLISHABLE_KEY: 'pk_live_fixture_not_a_real_key_xyz',
    });

    expect(result).toEqual({
      NODE_ENV: 'production',
      PORT: 4000,
      API_PREFIX: 'api',
      API_VERSION: 'v2',
      CORS_ORIGINS: ['https://example.com', 'https://foo.com'],
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      DATABASE_SSL: true,
      DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
      CLERK_SECRET_KEY: 'sk_live_fixture_not_a_real_key_xyz',
      CLERK_PUBLISHABLE_KEY: 'pk_live_fixture_not_a_real_key_xyz',
      CLERK_JWT_KEY: undefined,
      CLERK_AUTHORIZED_PARTIES: [],
      // Default-empty when not provided - see env.schema.ts's own comment
      // on why R2_* is not validated as required at this layer.
      R2_ENDPOINT: '',
      R2_ACCESS_KEY_ID: '',
      R2_SECRET_ACCESS_KEY: '',
      R2_BUCKET: '',
      R2_PUBLIC_URL: '',
    });
  });

  it('applies defaults when optional variables are missing', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
    });

    expect(result).toMatchObject({
      NODE_ENV: 'development',
      PORT: 3000,
      API_PREFIX: 'api',
      API_VERSION: 'v1',
      DATABASE_SSL: false,
      CLERK_AUTHORIZED_PARTIES: [],
    });
    expect(result.CLERK_PUBLISHABLE_KEY).toBeUndefined();
    expect(result.CLERK_JWT_KEY).toBeUndefined();
  });

  it('trims whitespace and drops empty entries from CORS_ORIGINS', () => {
    const result = validateEnv({
      CORS_ORIGINS: ' http://localhost:3000 ,, http://localhost:8081 ,',
      DATABASE_URL: VALID_DATABASE_URL,
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
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
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
    });
    expect(result.CORS_ORIGINS).toEqual([]);
  });

  it('rejects an invalid NODE_ENV value', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'staging',
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a non-positive PORT value', () => {
    expect(() =>
      validateEnv({
        PORT: '-1',
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects an empty CORS_ORIGINS outside of the test environment', () => {
    expect(() =>
      validateEnv({
        NODE_ENV: 'development',
        CORS_ORIGINS: '',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('accepts a postgres:// DATABASE_URL', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: 'postgres://user:password@localhost:5432/capoeira_hub',
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
    });

    expect(result.DATABASE_URL).toBe(
      'postgres://user:password@localhost:5432/capoeira_hub',
    );
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() =>
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('rejects a DATABASE_URL with an unsupported protocol', () => {
    expect(() =>
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: 'mysql://user:password@localhost:3306/capoeira_hub',
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  it('does not leak the DATABASE_URL value in the error message for an invalid protocol', () => {
    try {
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: 'mysql://user:supersecret@localhost:3306/capoeira_hub',
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
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
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
    });
    expect(result.DATABASE_SSL).toBe(true);
  });

  it('parses DATABASE_SSL=false', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
      DATABASE_SSL: 'false',
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
    });
    expect(result.DATABASE_SSL).toBe(false);
  });

  it('defaults DATABASE_SSL to false when not provided', () => {
    const result = validateEnv({
      CORS_ORIGINS: 'http://localhost:3000',
      DATABASE_URL: VALID_DATABASE_URL,
      CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
    });
    expect(result.DATABASE_SSL).toBe(false);
  });

  it('rejects an invalid DATABASE_SSL value', () => {
    expect(() =>
      validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        DATABASE_SSL: 'yes',
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      }),
    ).toThrow(/Invalid environment configuration/);
  });

  // Full rule coverage lives in database-env.schema.spec.ts - these only
  // pin that the app schema applies the same production database rules.
  describe('production database rules', () => {
    const productionEnv = (overrides: Record<string, unknown> = {}) => ({
      NODE_ENV: 'production',
      CORS_ORIGINS: 'https://example.com',
      DATABASE_URL: PRODUCTION_DATABASE_URL,
      DATABASE_SSL: 'true',
      DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
      CLERK_SECRET_KEY: 'sk_live_fixture_not_a_real_key_xyz',
      ...overrides,
    });

    it('rejects production without DATABASE_CA_CERT', () => {
      expect(() =>
        validateEnv(productionEnv({ DATABASE_CA_CERT: undefined })),
      ).toThrow(/DATABASE_CA_CERT: DATABASE_CA_CERT is required in production/);
    });

    it('rejects production without DATABASE_SSL', () => {
      expect(() =>
        validateEnv(productionEnv({ DATABASE_SSL: undefined })),
      ).toThrow(/DATABASE_SSL must be true in production/);
    });

    it('rejects production pointing at a local database', () => {
      expect(() =>
        validateEnv(productionEnv({ DATABASE_URL: VALID_DATABASE_URL })),
      ).toThrow(/DATABASE_URL must not point at a local database/);
    });

    it('rejects an invalid DATABASE_CA_CERT', () => {
      expect(() =>
        validateEnv(productionEnv({ DATABASE_CA_CERT: 'garbage' })),
      ).toThrow(/DATABASE_CA_CERT must be a PEM-encoded/);
    });
  });

  describe('CLERK_SECRET_KEY', () => {
    it('accepts a development (sk_test_) key', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: 'sk_test_fixture_not_a_real_key_xyz',
      });
      expect(result.CLERK_SECRET_KEY).toBe(
        'sk_test_fixture_not_a_real_key_xyz',
      );
    });

    it('accepts a production (sk_live_) key', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: 'sk_live_fixture_not_a_real_key_xyz',
      });
      expect(result.CLERK_SECRET_KEY).toBe(
        'sk_live_fixture_not_a_real_key_xyz',
      );
    });

    it('rejects a missing CLERK_SECRET_KEY', () => {
      expect(() =>
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
        }),
      ).toThrow(/Invalid environment configuration/);
    });

    it('rejects an empty CLERK_SECRET_KEY', () => {
      expect(() =>
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
          CLERK_SECRET_KEY: '',
        }),
      ).toThrow(/Invalid environment configuration/);
    });

    it('rejects a key with an unrecognized prefix', () => {
      expect(() =>
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
          CLERK_SECRET_KEY: 'not_a_clerk_key',
        }),
      ).toThrow(/Invalid environment configuration/);
    });

    it('does not leak the CLERK_SECRET_KEY value in the error message', () => {
      try {
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
          CLERK_SECRET_KEY: 'sk_test_totally_secret_value',
          DATABASE_SSL: 'yes',
        });
        throw new Error('expected validateEnv to throw');
      } catch (error) {
        expect((error as Error).message).not.toContain('totally_secret_value');
      }
    });
  });

  describe('CLERK_PUBLISHABLE_KEY', () => {
    it('is optional', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      });
      expect(result.CLERK_PUBLISHABLE_KEY).toBeUndefined();
    });

    it('accepts a valid pk_test_ value', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        CLERK_PUBLISHABLE_KEY: 'pk_test_fixture_not_a_real_key_xyz',
      });
      expect(result.CLERK_PUBLISHABLE_KEY).toBe(
        'pk_test_fixture_not_a_real_key_xyz',
      );
    });

    it('rejects a value with an unrecognized prefix', () => {
      expect(() =>
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
          CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
          CLERK_PUBLISHABLE_KEY: 'not_a_publishable_key',
        }),
      ).toThrow(/Invalid environment configuration/);
    });
  });

  describe('CLERK_JWT_KEY', () => {
    it('is undefined when not provided', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      });
      expect(result.CLERK_JWT_KEY).toBeUndefined();
    });

    it('is undefined for an empty string', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        CLERK_JWT_KEY: '',
      });
      expect(result.CLERK_JWT_KEY).toBeUndefined();
    });

    it('unescapes literal \\n sequences into real newlines', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        CLERK_JWT_KEY:
          '-----BEGIN PUBLIC KEY-----\\nABCDEF\\n-----END PUBLIC KEY-----',
      });
      expect(result.CLERK_JWT_KEY).toBe(
        '-----BEGIN PUBLIC KEY-----\nABCDEF\n-----END PUBLIC KEY-----',
      );
    });
  });

  describe('PUBLIC_WEB_BASE_URL', () => {
    it('is undefined when not provided - never a fabricated placeholder domain', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      });
      expect(result.PUBLIC_WEB_BASE_URL).toBeUndefined();
    });

    it('is undefined for an empty string', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        PUBLIC_WEB_BASE_URL: '',
      });
      expect(result.PUBLIC_WEB_BASE_URL).toBeUndefined();
    });

    it('strips a trailing slash so callers can safely interpolate /u/<code>', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        PUBLIC_WEB_BASE_URL: 'https://capohub.pl/',
      });
      expect(result.PUBLIC_WEB_BASE_URL).toBe('https://capohub.pl');
    });

    it('rejects a non-URL value', () => {
      expect(() =>
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
          CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
          PUBLIC_WEB_BASE_URL: 'not-a-url',
        }),
      ).toThrow(/Invalid environment configuration/);
    });
  });

  describe('CLERK_AUTHORIZED_PARTIES', () => {
    it('defaults to an empty array when not provided', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
      });
      expect(result.CLERK_AUTHORIZED_PARTIES).toEqual([]);
    });

    it('parses a single origin', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        CLERK_AUTHORIZED_PARTIES: 'http://localhost:8081',
      });
      expect(result.CLERK_AUTHORIZED_PARTIES).toEqual([
        'http://localhost:8081',
      ]);
    });

    it('parses multiple comma-separated origins and trims whitespace/empty entries', () => {
      const result = validateEnv({
        CORS_ORIGINS: 'http://localhost:3000',
        DATABASE_URL: VALID_DATABASE_URL,
        CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
        CLERK_AUTHORIZED_PARTIES:
          ' http://localhost:8081 ,, https://app.example.com ,',
      });
      expect(result.CLERK_AUTHORIZED_PARTIES).toEqual([
        'http://localhost:8081',
        'https://app.example.com',
      ]);
    });

    it('rejects an invalid URL among the origins', () => {
      expect(() =>
        validateEnv({
          CORS_ORIGINS: 'http://localhost:3000',
          DATABASE_URL: VALID_DATABASE_URL,
          CLERK_SECRET_KEY: VALID_CLERK_SECRET_KEY,
          CLERK_AUTHORIZED_PARTIES: 'not-a-url',
        }),
      ).toThrow(/Invalid environment configuration/);
    });
  });
});
