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
