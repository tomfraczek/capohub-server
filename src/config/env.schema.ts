import { z } from 'zod';

const parseCorsOrigins = (value: string): string[] =>
  value
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

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

const clerkSecretKeySchema = z
  .string()
  .min(1, 'CLERK_SECRET_KEY is required')
  .regex(
    /^sk_(test|live)_/,
    'CLERK_SECRET_KEY must start with sk_test_ or sk_live_',
  );

const clerkPublishableKeySchema = z
  .string()
  .regex(
    /^pk_(test|live)_/,
    'CLERK_PUBLISHABLE_KEY must start with pk_test_ or pk_live_',
  )
  .optional();

const isValidUrl = (value: string): boolean =>
  z.string().url().safeParse(value).success;

// .env files store multi-line PEM keys with literal "\n" sequences instead
// of real newlines - unescape them before the key is ever used. An empty
// value means "not configured" (networkless verification is optional).
const clerkJwtKeySchema = z
  .string()
  .default('')
  .transform((value) => value.replace(/\\n/g, '\n').trim())
  .transform((value) => (value.length === 0 ? undefined : value));

const clerkAuthorizedPartiesSchema = z
  .string()
  .default('')
  .transform(parseCorsOrigins)
  .refine((parties) => parties.every(isValidUrl), {
    message: 'CLERK_AUTHORIZED_PARTIES must contain only valid URLs',
  });

// R2 (Cloudflare, S3-compatible) storage config for the User/Group/Section/
// Event profile-image and cover-image upload endpoints (see
// storage/r2-client.provider.ts). Deliberately NOT required here the way
// CLERK_SECRET_KEY is - this project has no per-environment "does this env
// use storage" flag, and making all five mandatory at the global env-schema
// level would force every one of this file's ~30 pre-existing unit tests
// (env.schema.spec.ts) to grow unrelated fixture noise for a module they
// don't exercise. Instead each stays an optional, default-empty string
// here, and R2StorageService's own provider factory is the single place
// that actually enforces "all five must be non-empty" - failing fast at
// Nest bootstrap/DI-resolution time (same "fail readable at the moment the
// low-level client is built" pattern as clerk-client.provider.ts), not
// silently at first upload request. See r2-client.provider.ts.
const r2OptionalStringSchema = z.string().default('');

// The public web domain the mobile app's "Mój kod" QR / share link points
// at (e.g. "https://capohub.pl") - see qr-payload.util.ts's
// buildUserQrPayload (generates it) and parseQrPayload (the host a scanned
// User link must match to resolve - both here and in
// UserCheckInIdentityService's check-in QR scanning).
//
// CROSS-REPO INVARIANT: this value and the mobile app's own
// EXPO_PUBLIC_WEB_BASE_URL (capohub-mobile/src/config/env.ts, read by
// classify-checkin-qr-payload.ts and, at build time only, app.config.ts's
// Android App Links intentFilters) MUST resolve to the exact same host.
// If they drift, a QR this backend generates (or App Links registers)
// stops matching what the mobile scanner is willing to recognize as a
// User identity - there is no runtime check across the two repos that
// would ever catch that; keeping the two env values in sync is an
// operational responsibility, not something either codebase can enforce
// on its own. Host equality is compared via `new URL(...).host` on both
// sides, which is inherently insensitive to a trailing slash on either
// value (a trailing slash affects `.pathname`, never `.host`) - see
// qr-payload.util.spec.ts's own trailing-slash test - independent of the
// trailing-slash stripping this schema also does below.
//
// Deliberately optional, default-empty->undefined, same reasoning as
// CLERK_JWT_KEY above: there is no real production domain yet, and this
// must never be a fabricated placeholder. There is no fallback format when
// it's unset - buildUserQrPayload returns `null` (the app has no public
// users yet, so there is nothing to keep a legacy format working for - see
// the task history) and parseQrPayload can never recognize a User https
// link either, since there is no "correct" host to compare a scan
// against. Trailing slashes are stripped so callers can always safely
// interpolate `${publicWebBaseUrl}/u/<code>` without a doubled slash.
const publicWebBaseUrlSchema = z
  .string()
  .default('')
  .transform((value) => value.trim().replace(/\/+$/, ''))
  .transform((value) => (value.length === 0 ? undefined : value))
  .refine((value) => value === undefined || isValidUrl(value), {
    message: 'PUBLIC_WEB_BASE_URL must be a valid URL when set',
  });

export const envSchema = z
  .object({
    NODE_ENV: z
      .enum(['development', 'test', 'production'])
      .default('development'),
    PORT: z.coerce.number().int().positive().default(3000),
    API_PREFIX: z.string().min(1).default('api'),
    API_VERSION: z.string().min(1).default('v1'),
    CORS_ORIGINS: z.string().default(''),
    DATABASE_URL: databaseUrlSchema,
    DATABASE_SSL: databaseSslSchema,
    CLERK_SECRET_KEY: clerkSecretKeySchema,
    CLERK_PUBLISHABLE_KEY: clerkPublishableKeySchema,
    CLERK_JWT_KEY: clerkJwtKeySchema,
    CLERK_AUTHORIZED_PARTIES: clerkAuthorizedPartiesSchema,
    R2_ENDPOINT: r2OptionalStringSchema,
    R2_ACCESS_KEY_ID: r2OptionalStringSchema,
    R2_SECRET_ACCESS_KEY: r2OptionalStringSchema,
    R2_BUCKET: r2OptionalStringSchema,
    R2_PUBLIC_URL: r2OptionalStringSchema,
    PUBLIC_WEB_BASE_URL: publicWebBaseUrlSchema,
  })
  .transform((env) => ({
    ...env,
    CORS_ORIGINS: parseCorsOrigins(env.CORS_ORIGINS),
  }))
  .refine((env) => env.NODE_ENV === 'test' || env.CORS_ORIGINS.length > 0, {
    message:
      'CORS_ORIGINS must contain at least one origin outside of the test environment',
    path: ['CORS_ORIGINS'],
  });

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }

  return result.data;
}
