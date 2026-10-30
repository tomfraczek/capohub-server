import { X509Certificate } from 'node:crypto';
import { z } from 'zod';

// The database-only slice of the environment. Shared by the full app
// envSchema (env.schema.ts) and by the two processes that only ever talk to
// the database - the MikroORM CLI (mikro-orm.config.ts) and the deploy-time
// migration runner (database/migrate.ts) - so running migrations never
// requires Clerk, R2 or CORS configuration it has no use for, while the
// database rules themselves (SSL, CA, production guards) stay defined once.

export const nodeEnvSchema = z
  .enum(['development', 'test', 'production'])
  .default('development');

const databaseUrlSchema = z
  .string()
  .min(1, 'DATABASE_URL is required')
  .url('DATABASE_URL must be a valid URL')
  .refine((url) => /^postgres(ql)?:\/\//.test(url), {
    message: 'DATABASE_URL must use the postgresql:// or postgres:// protocol',
  });

// Deliberately not z.coerce.boolean() - that treats any non-empty string
// (including the literal "false") as truthy.
const databaseSslSchema = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const PEM_CERTIFICATE_PATTERN =
  /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g;

// Every PEM block must parse as a real X.509 certificate - a truncated or
// mangled value (a common copy/paste failure in a hosting panel) is
// rejected here with a readable message, not later as an opaque TLS
// handshake error.
function isValidPemCertificateBundle(value: string): boolean {
  const blocks = value.match(PEM_CERTIFICATE_PATTERN);
  if (!blocks) {
    return false;
  }
  try {
    for (const block of blocks) {
      new X509Certificate(block);
    }
    return true;
  } catch {
    return false;
  }
}

// CA certificate for verifying the PostgreSQL server (DigitalOcean Managed
// PostgreSQL signs with a per-project CA that is not in Node's trust store -
// bound in App Platform as ${<db>.CA_CERT}). Accepts a real multi-line PEM
// or a single-line value with literal "\n" sequences (same convention as
// CLERK_JWT_KEY). Empty means "not configured".
const databaseCaCertSchema = z
  .string()
  .default('')
  .transform((value) => value.replace(/\\n/g, '\n').replace(/\r\n/g, '\n'))
  .transform((value) => value.trim())
  .transform((value) => (value.length === 0 ? undefined : value))
  .refine(
    (value) => value === undefined || isValidPemCertificateBundle(value),
    {
      message:
        'DATABASE_CA_CERT must be a PEM-encoded X.509 certificate (-----BEGIN CERTIFICATE----- ... -----END CERTIFICATE-----)',
    },
  );

export const databaseEnvShape = {
  NODE_ENV: nodeEnvSchema,
  DATABASE_URL: databaseUrlSchema,
  DATABASE_SSL: databaseSslSchema,
  DATABASE_CA_CERT: databaseCaCertSchema,
};

const LOCAL_DATABASE_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

interface DatabaseEnvFields {
  NODE_ENV: 'development' | 'test' | 'production';
  DATABASE_URL: string;
  DATABASE_SSL: boolean;
  DATABASE_CA_CERT: string | undefined;
}

/**
 * Production-only guards, applied identically by the app and by the
 * migration processes. Outside production nothing here applies, so local
 * development against a plain, non-SSL Postgres keeps working unchanged.
 * Messages never include the offending value (DATABASE_URL carries the
 * password).
 */
export function checkProductionDatabaseRules(
  env: DatabaseEnvFields,
  ctx: z.RefinementCtx,
): void {
  if (env.NODE_ENV !== 'production') {
    return;
  }

  const host = new URL(env.DATABASE_URL).hostname;
  if (LOCAL_DATABASE_HOSTS.has(host)) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_URL'],
      message: 'DATABASE_URL must not point at a local database in production',
    });
  }

  if (!env.DATABASE_SSL) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_SSL'],
      message: 'DATABASE_SSL must be true in production',
    });
  } else if (!env.DATABASE_CA_CERT) {
    ctx.addIssue({
      code: 'custom',
      path: ['DATABASE_CA_CERT'],
      message:
        'DATABASE_CA_CERT is required in production when DATABASE_SSL=true (on DigitalOcean: ${<db>.CA_CERT})',
    });
  }
}

export const databaseEnvSchema = z
  .object(databaseEnvShape)
  .superRefine(checkProductionDatabaseRules);

export type DatabaseEnvConfig = z.infer<typeof databaseEnvSchema>;

export function formatEnvIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
    .join('\n');
}

export function validateDatabaseEnv(
  config: Record<string, unknown>,
): DatabaseEnvConfig {
  const result = databaseEnvSchema.safeParse(config);

  if (!result.success) {
    throw new Error(
      `Invalid database environment configuration:\n${formatEnvIssues(result.error)}`,
    );
  }

  return result.data;
}
