import { randomInt } from 'node:crypto';
import { EntityManager } from '@mikro-orm/postgresql';
import { isUniqueViolationOn } from './db-errors';

// Shared by User.numericCode and Event.numericCode - the single place the
// "6 digits" decision lives (see the module spec §14: length/regex must
// never be scattered across the codebase). Not a general identifier
// framework: this file only knows how to generate and safely persist one
// specific shape of code.
export const NUMERIC_CODE_LENGTH = 6;
export const NUMERIC_CODE_PATTERN = /^[0-9]{6}$/;
const MAX_GENERATION_ATTEMPTS = 10;

/**
 * A cryptographically random 6-digit code in "000000".."999999", always
 * returned as a zero-padded string - never Math.random(), never
 * sequential. Pure - no DB access, no uniqueness guarantee on its own (see
 * assignUniqueNumericCode).
 */
export function generateNumericCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(NUMERIC_CODE_LENGTH, '0');
}

/**
 * Normalizes a user-entered lookup code: accepts either the raw 6-digit
 * string ("123456") or the frontend's display format with a single
 * interior dash ("123-456"), and returns the raw 6-digit string. Returns
 * `null` for anything else (wrong length, non-digit characters, more than
 * one dash, dash in the wrong place) - callers must treat `null` as "reject
 * as malformed", never fall back to treating the input as a generic search
 * string.
 */
export function normalizeNumericCodeInput(raw: string): string | null {
  const withoutDash =
    raw.length === NUMERIC_CODE_LENGTH + 1 && raw[3] === '-'
      ? raw.slice(0, 3) + raw.slice(4)
      : raw;
  return NUMERIC_CODE_PATTERN.test(withoutDash) ? withoutDash : null;
}

/**
 * Same as normalizeNumericCodeInput, but also accepts the app's displayed
 * User code - an optional leading "U" (case-insensitive), e.g. "U123-456"
 * or "u123456" (see the mobile app's formatUserCode). A real numeric code
 * can never itself start with "U", so stripping it is always safe. Used
 * wherever a person types a User code they read off the app.
 */
export function normalizeUserCodeInput(raw: string): string | null {
  const withoutPrefix = /^u/i.test(raw) ? raw.slice(1) : raw;
  return normalizeNumericCodeInput(withoutPrefix);
}

/**
 * Generates a random 6-digit code and persists `entity` with it, retrying
 * with a fresh code (up to MAX_GENERATION_ATTEMPTS times) only when the
 * attempt fails on the specific unique constraint named
 * `uniqueConstraintName` - any other error propagates immediately.
 *
 * Each attempt runs in its own `em.transactional(...)` scope (a SAVEPOINT
 * when `em` is already inside a transaction, a fresh transaction
 * otherwise), so a failed attempt never poisons the caller's outer
 * transaction the way an uncaught constraint violation would. Deliberately
 * does not pre-check "does this code already exist" with a SELECT first
 * (see the module spec §3) - the unique constraint is the source of truth,
 * this is just a bounded retry around it.
 *
 * `attempt` must assign the generated code to the entity's numericCode
 * field and persist+flush it - callers differ slightly here (a brand-new
 * entity vs. one already `persist()`-ed earlier in a larger transaction),
 * so this stays a caller-provided callback rather than a fixed shape.
 */
export async function assignUniqueNumericCode(
  em: EntityManager,
  attempt: (trx: EntityManager, code: string) => Promise<void>,
  uniqueConstraintName: string,
): Promise<void> {
  for (let i = 0; i < MAX_GENERATION_ATTEMPTS; i++) {
    const code = generateNumericCode();
    try {
      await em.transactional((trx) => attempt(trx, code));
      return;
    } catch (error) {
      const isCollision = isUniqueViolationOn(error, uniqueConstraintName);
      const isLastAttempt = i === MAX_GENERATION_ATTEMPTS - 1;
      if (isCollision && !isLastAttempt) {
        continue;
      }
      if (isCollision) {
        // MAX_GENERATION_ATTEMPTS consecutive collisions in a 1,000,000-value
        // space is statistically impossible short of a serious bug or an
        // unexpectedly exhausted code space - same reasoning as
        // generateUniquePublicCode's own exhaustion error, deliberately a
        // plain Error (not a specific HttpException) so it surfaces as the
        // same generic 500 via HttpExceptionFilter.
        throw new Error(
          'Unable to generate a unique numeric code after multiple attempts - ' +
            'this is a critical error and should never occur in practice.',
        );
      }
      throw error;
    }
  }
}

/**
 * The leading digits of a (possibly partial) typed User code, for
 * search-as-you-type: an optional leading "U" (case-insensitive), then
 * digits with optional dashes, up to the full code length - "878",
 * "u878", "U878-0", "878-021" all qualify. Returns null for anything else
 * (no digits at all, letters after the "U", too many digits), so the
 * caller falls back to a plain name search.
 */
export function parseUserCodePrefix(raw: string): string | null {
  const match = /^u?([0-9-]+)$/i.exec(raw.trim());
  if (!match) return null;
  const digits = match[1].replace(/-/g, '');
  return digits.length > 0 && digits.length <= NUMERIC_CODE_LENGTH
    ? digits
    : null;
}
