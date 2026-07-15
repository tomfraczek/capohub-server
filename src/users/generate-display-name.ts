const FALLBACK_DISPLAY_NAME = 'Użytkownik';
const MAX_DISPLAY_NAME_LENGTH = 100;
const SEPARATOR_PATTERN = /[._-]+/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Derives a display name from the local part of an email address, e.g.
 * "john.silva@example.com" -> "John Silva". Falls back to a generic name
 * when no usable email is available. Never reads firstName/lastName/fullName
 * - Clerk is the source of truth for the account, but displayName is a
 * local, app-owned field seeded once at creation.
 */
export function generateDisplayNameFromEmail(
  email: string | null | undefined,
): string {
  const localPart = email?.split('@')[0];

  if (!localPart) {
    return FALLBACK_DISPLAY_NAME;
  }

  const words = localPart
    .replace(SEPARATOR_PATTERN, ' ')
    .replace(WHITESPACE_PATTERN, ' ')
    .trim()
    .split(' ')
    .filter((word) => word.length > 0);

  if (words.length === 0) {
    return FALLBACK_DISPLAY_NAME;
  }

  return words.map(capitalizeWord).join(' ').slice(0, MAX_DISPLAY_NAME_LENGTH);
}

function capitalizeWord(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
}
