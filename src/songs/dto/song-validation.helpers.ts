import { z } from 'zod';

// Re-exported from the neutral common module - this module is not the
// canonical owner, just one of several importers (see uuid.schema.ts).
export { uuidSchema } from '../../common/validation/uuid.schema';

// pt-BR-style codes: 2-3 lowercase letters, optionally a region subtag.
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

export const languageCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Must be at least 2 characters')
  .max(10, 'Must be at most 10 characters')
  .regex(
    LANGUAGE_CODE_PATTERN,
    'Must be a valid language code (e.g. "pl", "pt-br")',
  );

/**
 * A string field that is optional/nullable end-to-end: a missing key, an
 * explicit null, or an empty/whitespace-only string all normalize to `null`.
 * Used for every "optional text" field in the Song aggregate (authorName,
 * meaning*, phoneticText, media title) per the Etap 8.2 spec.
 */
export function optionalNullableText(maxLength: number) {
  return z
    .string()
    .trim()
    .max(maxLength, `Must be at most ${maxLength} characters`)
    .nullish()
    .transform((value) => (value ? value : null));
}

/**
 * Shared superRefine body for any array of `{ position: number }` items:
 * positions must be unique and form a contiguous 1..n sequence. Used for
 * alternativeTitles, parts, each part's lines, and media.
 */
export function checkSequentialPositions<T extends { position: number }>(
  items: readonly T[],
  ctx: z.RefinementCtx,
): void {
  const positions = items.map((item) => item.position);

  if (new Set(positions).size !== positions.length) {
    ctx.addIssue({
      code: 'custom',
      message: 'position values must not contain duplicates',
      path: ['position'],
    });
    return;
  }

  const sorted = [...positions].sort((a, b) => a - b);
  const isSequential = sorted.every((value, index) => value === index + 1);

  if (!isSequential) {
    ctx.addIssue({
      code: 'custom',
      message: 'position values must be sequential starting at 1',
      path: ['position'],
    });
  }
}

export function checkNoDuplicates<T>(
  items: readonly T[],
  keyOf: (item: T) => string,
  message: string,
  ctx: z.RefinementCtx,
): void {
  const keys = items.map(keyOf);

  if (new Set(keys).size !== keys.length) {
    ctx.addIssue({ code: 'custom', message });
  }
}

export function enumValuesSchema<T extends string>(
  values: readonly T[],
): z.ZodType<T> {
  return z.enum(values as [T, ...T[]]);
}
