import { SongStatus } from './enums/song-status.enum';

// Diacritic marks left behind by Unicode NFD decomposition (e.g. "ê" -> "e"
// + U+0302 COMBINING CIRCUMFLEX ACCENT). Written as explicit \u escapes
// rather than literal combining characters, which are invisible in source
// and easy to corrupt silently.
const COMBINING_MARKS_PATTERN = /[\u0300-\u036f]/g;
// U+2018/2019 curly single quotes, U+02BC/02BB modifier letters, backtick,
// U+00B4 acute accent - all folded to a plain ASCII apostrophe.
const APOSTROPHE_PATTERN = /[\u2018\u2019\u02bc\u02bb\u0060\u00b4]/g;
// U+201C/201D curly double quotes, U+00AB/00BB guillemets.
const QUOTE_PATTERN = /[\u201c\u201d\u00ab\u00bb]/g;
// U+2010-2015 hyphen/dash variants, U+2212 minus sign.
const DASH_PATTERN = /[\u2010-\u2015\u2212]/g;
const TRAILING_PUNCTUATION_PATTERN = /[,.;:!?]+$/;
const SPACE_BEFORE_PUNCTUATION_PATTERN = /\s+([,.;:!?])/g;
const WHITESPACE_PATTERN = /\s+/g;

/**
 * Central normalization for duplicate-detection comparisons (song titles
 * and first lines). Intentionally conservative: it only folds superficial
 * typographic variation (case, accents, spacing, quote/dash style) so that
 * "Paranauê", "paranaue" and "  PARANAUE  " compare as identical. It never
 * removes or reorders words and never applies language-specific stemming -
 * genuinely different lyrics must stay distinguishable.
 */
export function normalizeSongDuplicateText(text: string): string {
  const withoutDiacritics = text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(COMBINING_MARKS_PATTERN, '');

  return withoutDiacritics
    .replace(APOSTROPHE_PATTERN, "'")
    .replace(QUOTE_PATTERN, '"')
    .replace(DASH_PATTERN, '-')
    .replace(WHITESPACE_PATTERN, ' ')
    .replace(SPACE_BEFORE_PUNCTUATION_PATTERN, '$1')
    .replace(TRAILING_PUNCTUATION_PATTERN, '')
    .trim();
}

// Levenshtein distance on strings longer than this is both slow and
// pointless for duplicate detection (titles/first lines are short lyric
// fragments) - candidates are capped before the O(n*m) DP runs.
const MAX_COMPARISON_LENGTH = 300;

function capForComparison(text: string): string {
  return text.length > MAX_COMPARISON_LENGTH
    ? text.slice(0, MAX_COMPARISON_LENGTH)
    : text;
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) {
    return 0;
  }
  if (a.length === 0) {
    return b.length;
  }
  if (b.length === 0) {
    return a.length;
  }

  let previousRow = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 0; i < a.length; i++) {
    const currentRow = [i + 1];
    for (let j = 0; j < b.length; j++) {
      const insertCost = currentRow[j] + 1;
      const deleteCost = previousRow[j + 1] + 1;
      const substituteCost = previousRow[j] + (a[i] === b[j] ? 0 : 1);
      currentRow.push(Math.min(insertCost, deleteCost, substituteCost));
    }
    previousRow = currentRow;
  }

  return previousRow[b.length];
}

// 1 - (edit distance / longer length). Rewards near-identical strings
// (typos, single accent differences) with a score close to 1.
function editSimilarity(normalizedA: string, normalizedB: string): number {
  const a = capForComparison(normalizedA);
  const b = capForComparison(normalizedB);
  const maxLength = Math.max(a.length, b.length);
  if (maxLength === 0) {
    return 1;
  }
  return 1 - levenshteinDistance(a, b) / maxLength;
}

function tokenize(normalizedText: string): Set<string> {
  return new Set(normalizedText.split(' ').filter((token) => token.length > 0));
}

// Jaccard similarity over whitespace-separated word tokens. Rewards titles
// that share most of their words even when reordered or when a short word
// was inserted/removed (e.g. "Paranauê" vs "Paranauê Paraná").
function tokenSetSimilarity(normalizedA: string, normalizedB: string): number {
  const tokensA = tokenize(normalizedA);
  const tokensB = tokenize(normalizedB);

  if (tokensA.size === 0 || tokensB.size === 0) {
    return 0;
  }

  let intersectionSize = 0;
  for (const token of tokensA) {
    if (tokensB.has(token)) {
      intersectionSize += 1;
    }
  }

  const unionSize = tokensA.size + tokensB.size - intersectionSize;
  return intersectionSize / unionSize;
}

// Token overlap alone over-rewards short, generic shared words (see
// "isso e capoeira" vs "isso e outra coisa"), so it's discounted relative to
// edit similarity, which dominates for near-identical strings.
const TOKEN_SIMILARITY_WEIGHT = 0.9;

/**
 * Deterministic 0-1 similarity between two raw (not pre-normalized) text
 * fragments - either song titles or first lyric lines. Combines exact/edit-
 * distance similarity (catches typos and accent differences) with
 * token-set similarity (catches a short appended/removed word), taking
 * whichever signal is stronger. No randomness, no external fuzzy-search
 * dependency.
 */
export function computeSimilarity(rawA: string, rawB: string): number {
  const normalizedA = normalizeSongDuplicateText(rawA);
  const normalizedB = normalizeSongDuplicateText(rawB);

  if (normalizedA.length === 0 || normalizedB.length === 0) {
    return 0;
  }
  if (normalizedA === normalizedB) {
    return 1;
  }

  const similarity = Math.max(
    editSimilarity(normalizedA, normalizedB),
    tokenSetSimilarity(normalizedA, normalizedB) * TOKEN_SIMILARITY_WEIGHT,
  );

  return Math.max(0, Math.min(1, similarity));
}

/**
 * Same as computeSimilarity, but for the nullable "first line" field - if
 * either side has no line at all, the lines can't be confirmed similar, so
 * this deliberately returns 0 rather than guessing.
 */
export function computeOptionalTextSimilarity(
  a: string | null,
  b: string | null,
): number {
  if (a === null || b === null) {
    return 0;
  }
  return computeSimilarity(a, b);
}

// Below this, a title is treated as unrelated "noise" and never shown as a
// suggestion. Chosen in the middle of the 0.45-0.55 band the spec allows:
// low enough that a short appended/removed word (see tokenSetSimilarity)
// still surfaces as a suggestion, high enough that a single shared common
// word between otherwise different titles does not.
export const SUGGESTION_MIN_SIMILARITY = 0.5;

// Blocking thresholds (see isLikelyDuplicateMatch) - deliberately far
// stricter than the suggestion threshold above per the spec's guidance that
// it's better to let a real variant through to moderation than to block a
// legitimate, distinct song.
export const BLOCKING_TITLE_EXACT = 1;
export const BLOCKING_TITLE_HIGH = 0.95;
export const BLOCKING_LINE_IDENTICAL = 0.97;
export const BLOCKING_LINE_HIGH = 0.85;

export interface DuplicateMatchInput {
  titleSimilarity: number;
  // 0 when unknown (either song has no first line) - see
  // computeOptionalTextSimilarity - which never satisfies either rule
  // below, so a missing line can never itself trigger a block.
  firstLineSimilarity: number;
}

/**
 * The actual submit-blocking decision (spec section 12):
 *   A. normalized title identical AND first line identical/very similar
 *   B. title similarity >= 0.95 AND first line highly similar
 * Anything else (same title but different lyrics, similar lyrics but a
 * different title, or a similar-but-not-identical title with no line
 * evidence) is treated as a *possible* variant, not a blocking duplicate.
 */
export function isLikelyDuplicateMatch({
  titleSimilarity,
  firstLineSimilarity,
}: DuplicateMatchInput): boolean {
  if (
    titleSimilarity >= BLOCKING_TITLE_EXACT &&
    firstLineSimilarity >= BLOCKING_LINE_IDENTICAL
  ) {
    return true;
  }

  if (
    titleSimilarity >= BLOCKING_TITLE_HIGH &&
    firstLineSimilarity >= BLOCKING_LINE_HIGH
  ) {
    return true;
  }

  return false;
}

// APPROVED (PUBLISHED) ranks first, then PENDING_REVIEW, then the current
// user's own DRAFT/REJECTED - see spec section 9. HIDDEN/others never reach
// this comparator since they're excluded from candidate visibility.
const STATUS_DISPLAY_RANK: Partial<Record<SongStatus, number>> = {
  [SongStatus.PUBLISHED]: 0,
  [SongStatus.PENDING_REVIEW]: 1,
  [SongStatus.DRAFT]: 2,
  [SongStatus.REJECTED]: 2,
};

export interface RankableSuggestion {
  title: string;
  status: SongStatus;
  similarity: number;
}

/**
 * Sort order for suggestion results: similarity desc, then status rank,
 * then title as a stable alphabetical tie-breaker.
 */
export function compareSuggestionCandidates(
  a: RankableSuggestion,
  b: RankableSuggestion,
): number {
  if (b.similarity !== a.similarity) {
    return b.similarity - a.similarity;
  }

  const rankA = STATUS_DISPLAY_RANK[a.status] ?? 3;
  const rankB = STATUS_DISPLAY_RANK[b.status] ?? 3;
  if (rankA !== rankB) {
    return rankA - rankB;
  }

  return a.title.localeCompare(b.title);
}
