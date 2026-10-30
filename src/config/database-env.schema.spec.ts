import { TEST_DATABASE_CA_CERT } from '../../test/database-ca-cert.fixture';
import { validateDatabaseEnv } from './database-env.schema';

const LOCAL_DATABASE_URL =
  'postgresql://user:local-secret@localhost:5432/capoeira_hub';
const REMOTE_DATABASE_URL =
  'postgresql://doadmin:remote-secret@db-capohub.example.invalid:25060/defaultdb?sslmode=require';

const productionEnv = (overrides: Record<string, unknown> = {}) => ({
  NODE_ENV: 'production',
  DATABASE_URL: REMOTE_DATABASE_URL,
  DATABASE_SSL: 'true',
  DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
  ...overrides,
});

describe('validateDatabaseEnv', () => {
  it('needs only the database variables - no Clerk, R2 or CORS', () => {
    const result = validateDatabaseEnv(productionEnv());

    expect(result).toEqual({
      NODE_ENV: 'production',
      DATABASE_URL: REMOTE_DATABASE_URL,
      DATABASE_SSL: true,
      DATABASE_CA_CERT: TEST_DATABASE_CA_CERT,
    });
  });

  it('accepts local PostgreSQL without SSL or CA outside production', () => {
    const result = validateDatabaseEnv({ DATABASE_URL: LOCAL_DATABASE_URL });

    expect(result).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: LOCAL_DATABASE_URL,
      DATABASE_SSL: false,
      DATABASE_CA_CERT: undefined,
    });
  });

  it('accepts SSL without a CA outside production (verified against the default trust store)', () => {
    const result = validateDatabaseEnv({
      DATABASE_URL: REMOTE_DATABASE_URL,
      DATABASE_SSL: 'true',
    });

    expect(result.DATABASE_SSL).toBe(true);
    expect(result.DATABASE_CA_CERT).toBeUndefined();
  });

  describe('DATABASE_CA_CERT', () => {
    it('accepts a multi-line PEM', () => {
      const result = validateDatabaseEnv(productionEnv());

      expect(result.DATABASE_CA_CERT).toBe(TEST_DATABASE_CA_CERT);
    });

    it('unescapes literal \\n sequences into real newlines', () => {
      const result = validateDatabaseEnv(
        productionEnv({
          DATABASE_CA_CERT: TEST_DATABASE_CA_CERT.replace(/\n/g, '\\n'),
        }),
      );

      expect(result.DATABASE_CA_CERT).toBe(TEST_DATABASE_CA_CERT);
    });

    it('normalizes CRLF line endings and surrounding whitespace', () => {
      const result = validateDatabaseEnv(
        productionEnv({
          DATABASE_CA_CERT: `\n  ${TEST_DATABASE_CA_CERT.replace(/\n/g, '\r\n')}\r\n`,
        }),
      );

      expect(result.DATABASE_CA_CERT).toBe(TEST_DATABASE_CA_CERT);
    });

    it('accepts a bundle of several certificates', () => {
      const bundle = `${TEST_DATABASE_CA_CERT}\n${TEST_DATABASE_CA_CERT}`;
      const result = validateDatabaseEnv(
        productionEnv({ DATABASE_CA_CERT: bundle }),
      );

      expect(result.DATABASE_CA_CERT).toBe(bundle);
    });

    it('rejects a value that is not PEM', () => {
      expect(() =>
        validateDatabaseEnv(
          productionEnv({ DATABASE_CA_CERT: 'not-a-certificate' }),
        ),
      ).toThrow(/DATABASE_CA_CERT: DATABASE_CA_CERT must be a PEM-encoded/);
    });

    it('rejects a truncated certificate', () => {
      const lines = TEST_DATABASE_CA_CERT.split('\n');
      const truncated = [...lines.slice(0, 4), lines[lines.length - 1]].join(
        '\n',
      );

      expect(() =>
        validateDatabaseEnv(productionEnv({ DATABASE_CA_CERT: truncated })),
      ).toThrow(/DATABASE_CA_CERT must be a PEM-encoded/);
    });

    it('rejects a corrupted certificate body', () => {
      // Still well-formed base64 inside intact PEM markers, but no longer
      // valid DER - only a real X.509 parse catches this.
      const lines = TEST_DATABASE_CA_CERT.split('\n');
      lines[3] = [...lines[3]].reverse().join('');
      const corrupted = lines.join('\n');

      expect(() =>
        validateDatabaseEnv(productionEnv({ DATABASE_CA_CERT: corrupted })),
      ).toThrow(/DATABASE_CA_CERT must be a PEM-encoded/);
    });

    it('rejects an invalid certificate outside production too', () => {
      expect(() =>
        validateDatabaseEnv({
          DATABASE_URL: LOCAL_DATABASE_URL,
          DATABASE_CA_CERT:
            '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----',
        }),
      ).toThrow(/DATABASE_CA_CERT must be a PEM-encoded/);
    });
  });

  describe('production rules', () => {
    it('requires DATABASE_CA_CERT when DATABASE_SSL=true', () => {
      expect(() =>
        validateDatabaseEnv(productionEnv({ DATABASE_CA_CERT: undefined })),
      ).toThrow(/DATABASE_CA_CERT: DATABASE_CA_CERT is required in production/);
    });

    it('treats an empty DATABASE_CA_CERT as missing', () => {
      expect(() =>
        validateDatabaseEnv(productionEnv({ DATABASE_CA_CERT: '   ' })),
      ).toThrow(/DATABASE_CA_CERT is required in production/);
    });

    it('requires DATABASE_SSL=true', () => {
      expect(() =>
        validateDatabaseEnv(productionEnv({ DATABASE_SSL: 'false' })),
      ).toThrow(/DATABASE_SSL: DATABASE_SSL must be true in production/);
    });

    it('rejects a local database host', () => {
      for (const url of [
        LOCAL_DATABASE_URL,
        'postgresql://user:local-secret@127.0.0.1:5432/capoeira_hub',
        'postgresql://user:local-secret@[::1]:5432/capoeira_hub',
      ]) {
        expect(() =>
          validateDatabaseEnv(productionEnv({ DATABASE_URL: url })),
        ).toThrow(/DATABASE_URL must not point at a local database/);
      }
    });

    it('never includes the DATABASE_URL or its password in the error', () => {
      let message = '';
      try {
        validateDatabaseEnv(
          productionEnv({
            DATABASE_URL: LOCAL_DATABASE_URL,
            DATABASE_SSL: 'false',
          }),
        );
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toContain('Invalid database environment configuration');
      expect(message).not.toContain(LOCAL_DATABASE_URL);
      expect(message).not.toContain('local-secret');
    });
  });
});
