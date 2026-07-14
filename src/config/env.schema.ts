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
