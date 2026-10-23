import { SongRhythm } from '../../../rhythms/entities/song-rhythm.entity';
import { Song } from '../../../songs/entities/song.entity';
import { normalizeSongDuplicateText } from '../../../songs/song-duplicate.utils';
import { SongImportRecord } from './song-import.schema';

interface LocalizedTextSnapshot {
  languageCode: string;
  text: string;
}

interface TranslationSnapshot extends LocalizedTextSnapshot {
  isUncertain: boolean;
}

/**
 * The full, comparable content of one song - everything the import writes,
 * in one canonical shape that can be built both from an import record and
 * from a persisted Song. Two songs with deep-equal snapshots carry exactly
 * the same catalogue content. Database-only fields (ids, timestamps,
 * status, createdBy, media isVerified) are deliberately not part of
 * it - they never come from the import file.
 */
export interface SongContentSnapshot {
  title: string;
  authorName: string | null;
  categoryCode: string;
  alternativeTitles: { title: string; position: number }[];
  tagSlugs: string[];
  rhythms: { slug: string; isPrimary: boolean; description: string | null }[];
  parts: {
    performer: string;
    position: number;
    lines: {
      originalText: string;
      position: number;
      translations: TranslationSnapshot[];
      phonetics: LocalizedTextSnapshot[];
    }[];
  }[];
  media: {
    provider: string;
    url: string;
    title: string | null;
    position: number;
  }[];
  meaningHistory: string | null;
  meaningContext: string | null;
  meaningTrivia: string | null;
}

const byPosition = (a: { position: number }, b: { position: number }) =>
  a.position - b.position;
const byLanguage = <T extends LocalizedTextSnapshot>(a: T, b: T) =>
  a.languageCode.localeCompare(b.languageCode);

export function snapshotFromRecord(
  record: SongImportRecord,
): SongContentSnapshot {
  return {
    title: record.title,
    authorName: record.authorName,
    categoryCode: record.categoryCode,
    alternativeTitles: record.alternativeTitles
      .map(({ title, position }) => ({ title, position }))
      .sort(byPosition),
    tagSlugs: [...record.tagSlugs].sort(),
    rhythms: record.rhythms
      .map(({ slug, isPrimary, description }) => ({
        slug,
        isPrimary,
        description,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    parts: record.parts
      .map((part) => ({
        performer: part.performer,
        position: part.position,
        lines: part.lines
          .map((line) => ({
            originalText: line.originalText,
            position: line.position,
            // A file record without the flag means "certain" - the same
            // default the column has.
            translations: line.translations
              .map(({ languageCode, text, isUncertain }) => ({
                languageCode,
                text,
                isUncertain: isUncertain ?? false,
              }))
              .sort(byLanguage),
            phonetics: line.phonetics
              .map(({ languageCode, text }) => ({ languageCode, text }))
              .sort(byLanguage),
          }))
          .sort(byPosition),
      }))
      .sort(byPosition),
    media: record.media
      .map(({ provider, url, title, position }) => ({
        provider,
        url,
        title,
        position,
      }))
      .sort(byPosition),
    meaningHistory: record.meaningHistory,
    meaningContext: record.meaningContext,
    meaningTrivia: record.meaningTrivia,
  };
}

// Fields every snapshotFromSong() caller must populate - see
// SONG_SNAPSHOT_POPULATE.
export const SONG_SNAPSHOT_POPULATE = [
  'category',
  'alternativeTitles',
  'tags.tag',
  'parts.lines.translations',
  'parts.lines.phonetics',
  'media',
] as const;

/**
 * `song` must have SONG_SNAPSHOT_POPULATE loaded; `rhythmLinks` are the
 * song's SongRhythm rows with `rhythm` populated (Song has no inverse
 * collection for them - see song-rhythm.entity.ts).
 */
export function snapshotFromSong(
  song: Song,
  rhythmLinks: SongRhythm[],
): SongContentSnapshot {
  return {
    title: song.title,
    authorName: song.authorName,
    categoryCode: song.category.code,
    alternativeTitles: song.alternativeTitles
      .getItems()
      .map(({ title, position }) => ({ title, position }))
      .sort(byPosition),
    tagSlugs: song.tags
      .getItems()
      .map((songTag) => songTag.tag.slug)
      .sort(),
    rhythms: rhythmLinks
      .map((link) => ({
        slug: link.rhythm.slug,
        isPrimary: link.isPrimary,
        description: link.description,
      }))
      .sort((a, b) => a.slug.localeCompare(b.slug)),
    parts: song.parts
      .getItems()
      .map((part) => ({
        performer: part.performer,
        position: part.position,
        lines: part.lines
          .getItems()
          .map((line) => ({
            originalText: line.originalText,
            position: line.position,
            translations: line.translations
              .getItems()
              .map(({ languageCode, text, isUncertain }) => ({
                languageCode,
                text,
                isUncertain,
              }))
              .sort(byLanguage),
            phonetics: line.phonetics
              .getItems()
              .map(({ languageCode, text }) => ({ languageCode, text }))
              .sort(byLanguage),
          }))
          .sort(byPosition),
      }))
      .sort(byPosition),
    media: song.media
      .getItems()
      .map(({ provider, url, title, position }) => ({
        provider,
        url,
        title,
        position,
      }))
      .sort(byPosition),
    meaningHistory: song.meaningHistory,
    meaningContext: song.meaningContext,
    meaningTrivia: song.meaningTrivia,
  };
}

const MAX_REPORTED_DIFFERENCES = 20;

/**
 * Deep, exact comparison of two snapshots. Returns human-readable paths of
 * every differing value (e.g. `parts[3].lines[0].translations[0].text`),
 * capped at MAX_REPORTED_DIFFERENCES - an empty array means identical
 * content. Strings are compared byte-for-byte, so a truncated or retyped
 * text is always reported.
 */
export function diffSnapshots(
  expected: SongContentSnapshot,
  actual: SongContentSnapshot,
): string[] {
  const differences: string[] = [];
  collectDifferences(expected, actual, '', differences);
  return differences.slice(0, MAX_REPORTED_DIFFERENCES);
}

function collectDifferences(
  expected: unknown,
  actual: unknown,
  path: string,
  out: string[],
): void {
  if (out.length >= MAX_REPORTED_DIFFERENCES) {
    return;
  }

  if (Array.isArray(expected) && Array.isArray(actual)) {
    if (expected.length !== actual.length) {
      out.push(
        `${path}: expected ${expected.length} item(s), got ${actual.length}`,
      );
    }
    const shared = Math.min(expected.length, actual.length);
    for (let i = 0; i < shared; i++) {
      collectDifferences(expected[i], actual[i], `${path}[${i}]`, out);
    }
    return;
  }

  if (isPlainObject(expected) && isPlainObject(actual)) {
    for (const key of new Set([
      ...Object.keys(expected),
      ...Object.keys(actual),
    ])) {
      collectDifferences(
        expected[key],
        actual[key],
        path ? `${path}.${key}` : key,
        out,
      );
    }
    return;
  }

  if (expected !== actual) {
    out.push(`${path}: expected ${preview(expected)}, got ${preview(actual)}`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function preview(value: unknown): string {
  const text = JSON.stringify(value) ?? 'undefined';
  return text.length > 80 ? `${text.slice(0, 77)}...` : text;
}

// The first lyric line - with the normalized title, the same identity
// signal the submit-time duplicate check relies on (see
// isLikelyDuplicateMatch): same title + same first line = same song.
export function normalizedFirstLine(
  snapshot: SongContentSnapshot,
): string | null {
  const first = snapshot.parts[0]?.lines[0]?.originalText;
  return first ? normalizeSongDuplicateText(first) : null;
}
