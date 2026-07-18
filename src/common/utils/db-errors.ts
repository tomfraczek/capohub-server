import { UniqueConstraintViolationException } from '@mikro-orm/core';

/**
 * True when `error` is a UniqueConstraintViolationException raised by the
 * constraint whose name contains `constraintNameFragment` (e.g. "_slug_unique").
 * Used to give slug conflicts their own error code (spec section 11/13)
 * without hand-parsing the full driver error for anything more specific.
 */
export function isUniqueViolationOn(
  error: unknown,
  constraintNameFragment: string,
): boolean {
  return (
    error instanceof UniqueConstraintViolationException &&
    typeof error.message === 'string' &&
    error.message.includes(constraintNameFragment)
  );
}
