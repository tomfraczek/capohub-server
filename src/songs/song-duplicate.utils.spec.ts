import { SongStatus } from './enums/song-status.enum';
import {
  compareSuggestionCandidates,
  computeOptionalTextSimilarity,
  computeSimilarity,
  isLikelyDuplicateMatch,
  normalizeSongDuplicateText,
} from './song-duplicate.utils';

describe('normalizeSongDuplicateText', () => {
  it('lowercases the text', () => {
    expect(normalizeSongDuplicateText('PARANAUE')).toBe('paranaue');
  });

  it('trims leading and trailing whitespace', () => {
    expect(normalizeSongDuplicateText('  paranaue  ')).toBe('paranaue');
  });

  it('collapses multiple internal spaces into one', () => {
    expect(normalizeSongDuplicateText('vou   dizer  minha')).toBe(
      'vou dizer minha',
    );
  });

  it('strips diacritics via Unicode NFD decomposition', () => {
    expect(normalizeSongDuplicateText('Paranauê')).toBe('paranaue');
    expect(normalizeSongDuplicateText('São Bento Pequeno')).toBe(
      'sao bento pequeno',
    );
  });

  it('unifies curly and straight apostrophes', () => {
    expect(normalizeSongDuplicateText('capoeira’s song')).toBe(
      "capoeira's song",
    );
    expect(normalizeSongDuplicateText("capoeira's song")).toBe(
      "capoeira's song",
    );
  });

  it('unifies curly and straight double quotes', () => {
    expect(normalizeSongDuplicateText('“parana”')).toBe('"parana"');
  });

  it('unifies dash variants to a plain hyphen', () => {
    expect(normalizeSongDuplicateText('paranau–e')).toBe('paranau-e');
    expect(normalizeSongDuplicateText('paranau-e')).toBe('paranau-e');
  });

  it('removes trailing punctuation', () => {
    expect(normalizeSongDuplicateText('Paranaue!')).toBe('paranaue');
    expect(normalizeSongDuplicateText('Paranaue...')).toBe('paranaue');
    expect(normalizeSongDuplicateText('Paranaue?')).toBe('paranaue');
  });

  it('removes space before punctuation', () => {
    expect(normalizeSongDuplicateText('ola , mundo')).toBe('ola, mundo');
  });

  it('treats known-equivalent variants as identical', () => {
    const variants = ['Paranauê', 'paranaue', '  Paranauê  ', 'PARANAUE'];
    const normalized = variants.map(normalizeSongDuplicateText);
    expect(new Set(normalized).size).toBe(1);
    expect(normalized[0]).toBe('paranaue');
  });

  it('never removes words', () => {
    expect(normalizeSongDuplicateText('Paranauê Paraná')).toBe(
      'paranaue parana',
    );
  });
});

describe('computeSimilarity', () => {
  it('returns 1 for identical titles', () => {
    expect(computeSimilarity('Paranauê', 'Paranauê')).toBe(1);
  });

  it('returns 1 for titles differing only by diacritics/case/spacing', () => {
    expect(computeSimilarity('Paranauê', 'paranaue')).toBe(1);
    expect(computeSimilarity('  Paranauê  ', 'PARANAUE')).toBe(1);
  });

  it('returns a very high score for a single-character typo', () => {
    const similarity = computeSimilarity('Paranauê', 'Paranaue1');
    expect(similarity).toBeGreaterThanOrEqual(0.85);
    expect(similarity).toBeLessThan(1);
  });

  it('returns a high-to-medium score for a short appended word', () => {
    const similarity = computeSimilarity('Paranauê', 'Paranauê Paraná');
    expect(similarity).toBeGreaterThanOrEqual(0.45);
    expect(similarity).toBeLessThan(0.9);
  });

  it('returns a similar high-to-medium score for a similar prefix', () => {
    const similarity = computeSimilarity(
      'Vou dizer minha mulher',
      'Vou dizer minha mulher Paraná',
    );
    expect(similarity).toBeGreaterThanOrEqual(0.45);
  });

  it('returns a low score when only one short word is shared', () => {
    const similarity = computeSimilarity(
      'Vou dizer minha mulher',
      'Vou embora pra Bahia',
    );
    expect(similarity).toBeLessThan(0.5);
  });

  it('returns a score close to 0 for completely different titles', () => {
    const similarity = computeSimilarity('Paranauê', 'Zum zum zum');
    expect(similarity).toBeLessThan(0.2);
  });

  it('is symmetric', () => {
    expect(computeSimilarity('Paranauê', 'Paranauê Paraná')).toBe(
      computeSimilarity('Paranauê Paraná', 'Paranauê'),
    );
  });

  it('is deterministic across repeated calls', () => {
    const results = Array.from({ length: 5 }, () =>
      computeSimilarity('Paranauê', 'Paranauê Paraná'),
    );
    expect(new Set(results).size).toBe(1);
  });

  it('never returns a value outside [0, 1]', () => {
    expect(computeSimilarity('', 'anything')).toBeGreaterThanOrEqual(0);
    expect(computeSimilarity('a', 'a')).toBeLessThanOrEqual(1);
  });
});

describe('computeOptionalTextSimilarity', () => {
  it('returns 0 when either side is null', () => {
    expect(computeOptionalTextSimilarity(null, 'text')).toBe(0);
    expect(computeOptionalTextSimilarity('text', null)).toBe(0);
    expect(computeOptionalTextSimilarity(null, null)).toBe(0);
  });

  it('delegates to computeSimilarity when both sides are present', () => {
    expect(computeOptionalTextSimilarity('Paranauê', 'paranaue')).toBe(1);
  });
});

describe('isLikelyDuplicateMatch', () => {
  it('blocks when the title is identical and the first line is identical', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 1,
        firstLineSimilarity: 1,
      }),
    ).toBe(true);
  });

  it('blocks when the title is identical and the first line is very similar', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 1,
        firstLineSimilarity: 0.98,
      }),
    ).toBe(true);
  });

  it('does not block when the title is identical but the text is clearly different', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 1,
        firstLineSimilarity: 0.1,
      }),
    ).toBe(false);
  });

  it('blocks when the title is very similar (>=0.95) and the line is highly similar', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 0.96,
        firstLineSimilarity: 0.9,
      }),
    ).toBe(true);
  });

  it('does not block when the title is similar but not similar enough (<0.95)', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 0.8,
        firstLineSimilarity: 0.95,
      }),
    ).toBe(false);
  });

  it('does not block on a similar title with no line evidence (firstLineSimilarity 0)', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 0.97,
        firstLineSimilarity: 0,
      }),
    ).toBe(false);
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 1,
        firstLineSimilarity: 0,
      }),
    ).toBe(false);
  });

  it('does not block when only the text is similar but the title is not', () => {
    expect(
      isLikelyDuplicateMatch({
        titleSimilarity: 0.3,
        firstLineSimilarity: 1,
      }),
    ).toBe(false);
  });
});

describe('compareSuggestionCandidates', () => {
  it('sorts by similarity descending first', () => {
    const low = { title: 'B', status: SongStatus.PUBLISHED, similarity: 0.5 };
    const high = { title: 'A', status: SongStatus.DRAFT, similarity: 0.9 };
    expect(compareSuggestionCandidates(high, low)).toBeLessThan(0);
    expect(compareSuggestionCandidates(low, high)).toBeGreaterThan(0);
  });

  it('ranks PUBLISHED before PENDING_REVIEW before DRAFT/REJECTED at equal similarity', () => {
    const published = {
      title: 'A',
      status: SongStatus.PUBLISHED,
      similarity: 0.8,
    };
    const pending = {
      title: 'A',
      status: SongStatus.PENDING_REVIEW,
      similarity: 0.8,
    };
    const draft = { title: 'A', status: SongStatus.DRAFT, similarity: 0.8 };

    expect(compareSuggestionCandidates(published, pending)).toBeLessThan(0);
    expect(compareSuggestionCandidates(pending, draft)).toBeLessThan(0);
    expect(compareSuggestionCandidates(published, draft)).toBeLessThan(0);
  });

  it('falls back to alphabetical title order as a stable tie-breaker', () => {
    const a = { title: 'Alpha', status: SongStatus.DRAFT, similarity: 0.7 };
    const b = { title: 'Beta', status: SongStatus.DRAFT, similarity: 0.7 };
    expect(compareSuggestionCandidates(a, b)).toBeLessThan(0);
    expect(compareSuggestionCandidates(b, a)).toBeGreaterThan(0);
  });
});
