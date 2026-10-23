import { z } from 'zod';
import { createSongSchema } from '../../../songs/dto/create-song.schema';
import {
  checkNoDuplicates,
  optionalNullableText,
} from '../../../songs/dto/song-validation.helpers';
import { SongMediaProvider } from '../../../songs/enums/song-media-provider.enum';
import { normalizeSongDuplicateText } from '../../../songs/song-duplicate.utils';

// The only file format version this importer understands. A future,
// incompatible layout must bump this instead of silently changing meaning.
export const SONG_IMPORT_FORMAT_VERSION = 1;

// Curated catalogue content always ships with a Polish translation for
// every single line - a line without one is treated as incomplete data,
// not as an optional field (unlike POST /songs, where translations are
// genuinely optional).
export const REQUIRED_TRANSLATION_LANGUAGES = ['pl'] as const;

// Phrases that only ever appear in an editor's note *about* a translation,
// never in a translation itself - those notes belong in the isUncertain
// flag or in meaningContext/meaningTrivia, not in translations[].text.
const EDITORIAL_NOTE_PATTERN =
  /wers niejasny|niejasn|niejednoznaczn|niepewn|wymaga potwierdzenia|do weryfikacji|brak tłumaczenia|dosłownie:|sens (?:przybliżony|interpretowany)|śpiewne zawołanie|okrzyk (?:rytmiczny|melodyczny)|wokaliza|według poetyckiego ujęcia/i;

/**
 * Returns why `text` looks like (or contains) an editor's note instead of a
 * plain translation of `originalText`, or null when it reads as a normal
 * translation. Brackets/parentheses only count when the original line has
 * none of its own - a gloss the translator added, e.g. "Iê (śpiewne
 * zawołanie)".
 */
export function findEditorialNote(
  originalText: string,
  text: string,
): string | null {
  if (/[[\]]/.test(text)) {
    return 'contains a [bracketed] note';
  }
  if (/[()]/.test(text) && !/[()]/.test(originalText)) {
    return 'contains a (parenthesized) note the original line does not have';
  }
  const phrase = EDITORIAL_NOTE_PATTERN.exec(text);
  if (phrase) {
    return `contains the editorial phrase "${phrase[0]}"`;
  }
  return null;
}

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const YOUTUBE_VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(120)
  .regex(SLUG_PATTERN, 'Must be a lowercase kebab-case slug');

const rhythmLinkSchema = z
  .object({
    slug: slugSchema,
    isPrimary: z.boolean().default(false),
    description: optionalNullableText(2000),
  })
  .strict();

/**
 * Extracts the 11-character video id from the YouTube URL shapes the app
 * can play (see the mobile song-media-embed util) - watch?v=, youtu.be/,
 * /embed/, /shorts/, /live/. Returns null for anything else (playlists,
 * channels, malformed ids), which the import rejects: a catalogue song
 * must link to one concrete recording.
 */
export function extractYouTubeVideoId(rawUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return null;
  }

  const host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  const segments = url.pathname.split('/').filter((segment) => segment);
  let videoId: string | null = null;

  if (host === 'youtu.be') {
    videoId = segments[0] ?? null;
  } else if (host === 'youtube.com') {
    if (segments[0] === 'watch') {
      videoId = url.searchParams.get('v');
    } else if (['embed', 'shorts', 'live'].includes(segments[0] ?? '')) {
      videoId = segments[1] ?? null;
    }
  }

  return videoId && YOUTUBE_VIDEO_ID_PATTERN.test(videoId) ? videoId : null;
}

/**
 * One song record of an import file. Deliberately built on top of
 * createSongSchema (POST /songs) so every content rule - lengths,
 * sequential positions, LEAD/CHORUS, media domain allowlist, null
 * normalization - is the exact same one the API enforces. Only the
 * references differ: an import file can't know database UUIDs, so it names
 * the category/tags/rhythms by their stable code/slug instead.
 */
export const songImportRecordSchema = createSongSchema
  .omit({ categoryId: true, tagIds: true })
  .extend({
    categoryCode: z.string().trim().min(1).max(50),
    tagSlugs: z
      .array(slugSchema)
      .default([])
      .superRefine((items, ctx) =>
        checkNoDuplicates(
          items,
          (item) => item,
          'tagSlugs must not contain duplicates',
          ctx,
        ),
      ),
    rhythms: z
      .array(rhythmLinkSchema)
      .default([])
      .superRefine((items, ctx) => {
        checkNoDuplicates(
          items,
          (item) => item.slug,
          'rhythms must not reference the same rhythm twice',
          ctx,
        );
        if (items.filter((item) => item.isPrimary).length > 1) {
          ctx.addIssue({
            code: 'custom',
            message: 'at most one rhythm can be marked isPrimary',
          });
        }
      }),
  })
  .strict()
  .superRefine((song, ctx) => {
    song.parts.forEach((part, partIndex) => {
      part.lines.forEach((line, lineIndex) => {
        line.translations.forEach((translation, translationIndex) => {
          const note = findEditorialNote(line.originalText, translation.text);
          if (note) {
            ctx.addIssue({
              code: 'custom',
              message: `translation ${note} - use isUncertain and meaningContext/meaningTrivia instead`,
              path: [
                'parts',
                partIndex,
                'lines',
                lineIndex,
                'translations',
                translationIndex,
                'text',
              ],
            });
          }
        });
        for (const languageCode of REQUIRED_TRANSLATION_LANGUAGES) {
          if (!line.translations.some((t) => t.languageCode === languageCode)) {
            ctx.addIssue({
              code: 'custom',
              message: `line is missing its "${languageCode}" translation`,
              path: ['parts', partIndex, 'lines', lineIndex, 'translations'],
            });
          }
        }
      });
    });

    song.media.forEach((media, mediaIndex) => {
      if (
        media.provider === SongMediaProvider.YOUTUBE &&
        !extractYouTubeVideoId(media.url)
      ) {
        ctx.addIssue({
          code: 'custom',
          message: 'YouTube URL must point to a single video (11-char id)',
          path: ['media', mediaIndex, 'url'],
        });
      }
    });
  });

export const songImportFileSchema = z
  .object({
    formatVersion: z.literal(SONG_IMPORT_FORMAT_VERSION),
    songs: z.array(songImportRecordSchema).min(1),
  })
  .strict();

export type SongImportRecord = z.infer<typeof songImportRecordSchema>;
export type SongImportRhythmLink = z.infer<typeof rhythmLinkSchema>;

export interface SongImportFileContent {
  fileName: string;
  data: unknown;
}

// A validated record plus where it came from, so every report line can
// point back at the exact file/index to fix.
export interface SongImportEntry {
  source: string;
  record: SongImportRecord;
}

export interface SongImportDatasetValidation {
  entries: SongImportEntry[];
  errors: string[];
}

/**
 * Every title and alternative title of a record, normalized the same way
 * the duplicate detection does (case, accents, quotes, spacing, trailing
 * punctuation). This is what the importer matches existing songs on.
 */
export function collectNormalizedNames(
  record: Pick<SongImportRecord, 'title' | 'alternativeTitles'>,
): Set<string> {
  return new Set(
    [record.title, ...record.alternativeTitles.map((alt) => alt.title)].map(
      normalizeSongDuplicateText,
    ),
  );
}

/**
 * Validates a whole set of import files at once - per-record schema
 * validation plus the cross-record rules a single record can't check on
 * its own: no two records may share a (normalized) title or alternative
 * title, since that would make them indistinguishable to the importer.
 * Any error here means nothing must be imported.
 */
export function validateSongImportDataset(
  files: SongImportFileContent[],
): SongImportDatasetValidation {
  const entries: SongImportEntry[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const parsed = songImportFileSchema.safeParse(file.data);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(
          `${file.fileName}: ${describeIssuePath(file.data, issue.path)}: ${issue.message}`,
        );
      }
      continue;
    }

    parsed.data.songs.forEach((record, index) => {
      entries.push({ source: `${file.fileName}#${index + 1}`, record });
    });
  }

  const ownersByName = new Map<string, SongImportEntry>();
  for (const entry of entries) {
    for (const name of collectNormalizedNames(entry.record)) {
      const owner = ownersByName.get(name);
      if (owner && owner !== entry) {
        errors.push(
          `${entry.source} "${entry.record.title}": title/alternative title "${name}" is already used by ${owner.source} "${owner.record.title}"`,
        );
      } else {
        ownersByName.set(name, entry);
      }
    }
  }

  return { entries, errors };
}

// "songs[3].parts[1].lines[0]" alone is hard to act on in a 4000-line
// file - prefix it with the record's own title when there is one.
function describeIssuePath(data: unknown, path: PropertyKey[]): string {
  const joined = path
    .map((segment) =>
      typeof segment === 'number' ? `[${segment}]` : `.${String(segment)}`,
    )
    .join('')
    .replace(/^\./, '');

  if (path[0] !== 'songs' || typeof path[1] !== 'number') {
    return joined || '(root)';
  }

  const songs = (data as { songs?: unknown[] }).songs;
  const title = (songs?.[path[1]] as { title?: unknown } | undefined)?.title;
  return typeof title === 'string' ? `${joined} ("${title}")` : joined;
}
