// Slug format shared by every slugged CMS entity (Instrument, Rhythm, ...):
// lowercase ASCII letters, digits and single hyphens, no leading/trailing
// or repeated hyphens.
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// Diacritic marks left behind by Unicode NFD decomposition (e.g. "e" +
// U+0302 COMBINING CIRCUMFLEX ACCENT). Written as an explicit \u escape
// range rather than literal combining characters, which are invisible in
// source and easy to corrupt silently (see normalizeSongDuplicateText).
const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;

/**
 * Derives a URL-safe slug from a display name (diacritic folding + ASCII
 * lowercasing + hyphenation) - used only as a create-time default when the
 * CMS caller doesn't supply its own slug. Never called on rename, so
 * existing slugs (and links to them) never change underneath a caller.
 */
export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}
