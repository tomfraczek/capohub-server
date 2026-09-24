import { z } from 'zod';

// Query params always arrive as strings. This pattern rejects anything that
// isn't a plain, unsigned integer literal (no "1.5", "1abc", "-1", "").
const POSITIVE_INTEGER_PATTERN = /^\d+$/;

/**
 * Builds a schema that parses a query string into an integer, then applies
 * the given number schema (bounds, defaults, etc.) to the parsed value.
 */
export function integerQueryParam(numberSchema: z.ZodNumber) {
  return z
    .string()
    .regex(POSITIVE_INTEGER_PATTERN, 'Must be a positive integer')
    .transform((value) => Number(value))
    .pipe(numberSchema);
}

export const positiveIntegerQuerySchema = integerQueryParam(
  z.number().int().positive(),
);

// Same "parse the query string, then pipe through a number schema for
// bounds" shape as integerQueryParam above, but for a signed decimal - used
// for latitude/longitude query params (e.g. "-90.123456"), which
// integerQueryParam's unsigned-integer-only pattern can't accept.
const SIGNED_DECIMAL_PATTERN = /^-?\d+(\.\d+)?$/;

export function numberQueryParam(numberSchema: z.ZodNumber) {
  return z
    .string()
    .regex(SIGNED_DECIMAL_PATTERN, 'Must be a number')
    .transform((value) => Number(value))
    .pipe(numberSchema);
}

// Deliberately not z.coerce.boolean() - that treats any non-empty string
// (including the literal "false") as truthy.
export const booleanQuerySchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const trimmedStringQuerySchema = z.string().trim().min(1);

// A missing param is `undefined` (valid). A present-but-empty param fails
// min(1) rather than silently becoming `undefined` - callers that want that
// behavior should transform explicitly.
export const optionalTrimmedStringQuerySchema =
  trimmedStringQuerySchema.optional();

export const uuidQuerySchema = z.string().trim().uuid('Must be a valid UUID');
