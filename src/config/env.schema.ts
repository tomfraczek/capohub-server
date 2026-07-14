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
