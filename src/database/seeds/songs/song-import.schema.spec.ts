import { join } from 'node:path';
import { SongPerformer } from '../../../songs/enums/song-performer.enum';
import { loadSongImportFiles } from './song-import';
import {
  extractYouTubeVideoId,
  findEditorialNote,
  SONG_IMPORT_FORMAT_VERSION,
  SongImportFileContent,
  songImportRecordSchema,
  validateSongImportDataset,
} from './song-import.schema';

const SONGS_DIRECTORY = join(__dirname, '../../../../songs');

type RawRecord = Record<string, unknown> & {
  parts: {
    performer: string;
    position: number;
    lines: {
      originalText: string;
      position: number;
      translations: { languageCode: string; text: string }[];
    }[];
  }[];
  media: Record<string, unknown>[];
};

function validRecord(overrides: Record<string, unknown> = {}): RawRecord {
  return {
    title: 'Paranauê',
    authorName: null,
    categoryCode: 'CORRIDO',
    alternativeTitles: [{ title: 'Paraná ê', position: 1 }],
    tagSlugs: [],
    rhythms: [],
    parts: [
      {
        performer: 'LEAD',
        position: 1,
        lines: [
          {
            originalText: 'Vou dizer à minha mulher, Paraná',
            position: 1,
            translations: [
              { languageCode: 'pl', text: 'Powiem mojej żonie, Paraná' },
            ],
          },
        ],
      },
      {
        performer: 'CHORUS',
        position: 2,
        lines: [
          {
            originalText: 'Paranauê, paranauê, Paraná',
            position: 1,
            translations: [
              { languageCode: 'pl', text: 'Paranauê, paranauê, Paraná' },
            ],
          },
        ],
      },
    ],
    media: [
      {
        provider: 'YOUTUBE',
        url: 'https://www.youtube.com/watch?v=54JRejHOixA',
        title: null,
        position: 1,
      },
    ],
    meaningHistory: 'Historia.',
    meaningContext: 'Kontekst.',
    meaningTrivia: 'Ciekawostka.',
    ...overrides,
  };
}

function file(
  songs: unknown[],
  fileName = 'test.json',
  formatVersion: unknown = SONG_IMPORT_FORMAT_VERSION,
): SongImportFileContent {
  return { fileName, data: { formatVersion, songs } };
}

function errorsFor(songs: unknown[]): string[] {
  return validateSongImportDataset([file(songs)]).errors;
}

describe('song import file validation', () => {
  describe('the bundled songs/ dataset', () => {
    const files = loadSongImportFiles(SONGS_DIRECTORY);
    const result = validateSongImportDataset(files);

    it('has 5 files with exactly 10 songs each and one formatVersion', () => {
      expect(files).toHaveLength(5);
      for (const { data } of files) {
        const content = data as { formatVersion: unknown; songs: unknown[] };
        expect(content.formatVersion).toBe(SONG_IMPORT_FORMAT_VERSION);
        expect(content.songs).toHaveLength(10);
      }
    });

    it('validates without a single error', () => {
      expect(result.errors).toEqual([]);
      expect(result.entries).toHaveLength(50);
    });

    it('contains 50 distinct songs (titles unique even after normalization)', () => {
      const titles = result.entries.map((e) => e.record.title.toLowerCase());
      expect(new Set(titles).size).toBe(50);
    });

    it('gives every line its original text and a Polish translation', () => {
      for (const { record } of result.entries) {
        for (const part of record.parts) {
          expect([SongPerformer.LEAD, SongPerformer.CHORUS]).toContain(
            part.performer,
          );
          for (const line of part.lines) {
            expect(line.originalText.length).toBeGreaterThan(0);
            const pl = line.translations.filter((t) => t.languageCode === 'pl');
            expect(pl).toHaveLength(1);
            expect(pl[0].text.length).toBeGreaterThan(0);
          }
        }
      }
    });

    it('keeps repeated chorus parts as separate parts (no deduplication)', () => {
      const paranaue = result.entries.find(
        (e) => e.record.title === 'Paranauê',
      )!.record;
      const choruses = paranaue.parts.filter(
        (p) => p.performer === SongPerformer.CHORUS,
      );
      expect(choruses).toHaveLength(12);
      expect(new Set(choruses.map((p) => p.lines[0].originalText)).size).toBe(
        1,
      );
    });

    it('handles empty tagSlugs/rhythms arrays and null authors/media titles', () => {
      const first = result.entries[0].record;
      expect(first.tagSlugs).toEqual([]);
      expect(first.rhythms).toEqual([]);
      expect(first.authorName).toBeNull();
      expect(first.media[0].title).toBeNull();
    });
  });

  describe('valid optional values', () => {
    it('accepts a minimal valid record', () => {
      expect(errorsFor([validRecord()])).toEqual([]);
    });

    it('normalizes missing/empty optional text to null', () => {
      const parsed = songImportRecordSchema.parse(
        validRecord({
          authorName: '   ',
          meaningHistory: null,
          meaningContext: '',
          meaningTrivia: undefined,
        }),
      );
      expect(parsed.authorName).toBeNull();
      expect(parsed.meaningHistory).toBeNull();
      expect(parsed.meaningContext).toBeNull();
      expect(parsed.meaningTrivia).toBeNull();
    });

    it('defaults missing tagSlugs/rhythms/alternativeTitles/media to []', () => {
      const record = validRecord();
      delete record.tagSlugs;
      delete record.rhythms;
      delete record.alternativeTitles;
      record.media = [];
      const parsed = songImportRecordSchema.parse(record);
      expect(parsed.tagSlugs).toEqual([]);
      expect(parsed.rhythms).toEqual([]);
      expect(parsed.alternativeTitles).toEqual([]);
      expect(parsed.media).toEqual([]);
    });

    it('accepts rhythm links with defaults', () => {
      const parsed = songImportRecordSchema.parse(
        validRecord({ rhythms: [{ slug: 'sao-bento-grande' }] }),
      );
      expect(parsed.rhythms).toEqual([
        { slug: 'sao-bento-grande', isPrimary: false, description: null },
      ]);
    });

    it('does not truncate long meaning texts', () => {
      const long = 'ą'.repeat(9_999);
      const parsed = songImportRecordSchema.parse(
        validRecord({ meaningHistory: long }),
      );
      expect(parsed.meaningHistory).toBe(long);
    });
  });

  describe('invalid data', () => {
    it('rejects an unsupported formatVersion', () => {
      const { errors } = validateSongImportDataset([
        file([validRecord()], 'v2.json', 2),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('v2.json: formatVersion');
    });

    it('rejects unknown fields (e.g. a database categoryId)', () => {
      expect(
        errorsFor([validRecord({ categoryId: 'x' })]).join('\n'),
      ).toContain('Unrecognized key');
    });

    it('rejects a line without a Polish translation', () => {
      const record = validRecord();
      record.parts[0].lines[0].translations = [
        { languageCode: 'en', text: "I'll tell my wife" },
      ];
      expect(errorsFor([record]).join('\n')).toContain(
        'missing its "pl" translation',
      );
    });

    it('rejects an unknown performer role', () => {
      const record = validRecord();
      record.parts[0].performer = 'SOLO';
      expect(errorsFor([record]).join('\n')).toContain('performer');
    });

    it('rejects non-sequential part and line positions', () => {
      const parts = validRecord();
      parts.parts[1].position = 3;
      expect(errorsFor([parts]).join('\n')).toContain(
        'position values must be sequential starting at 1',
      );

      const lines = validRecord();
      lines.parts[0].lines[0].position = 2;
      expect(errorsFor([lines]).join('\n')).toContain('lines');
    });

    it('rejects an empty part and a song without parts', () => {
      const emptyPart = validRecord();
      emptyPart.parts[0].lines = [];
      expect(errorsFor([emptyPart]).join('\n')).toContain(
        'A part must have at least one line',
      );
      expect(errorsFor([validRecord({ parts: [] })]).join('\n')).toContain(
        'A song must have at least one part',
      );
    });

    it('rejects malformed YouTube links and wrong-provider domains', () => {
      for (const url of [
        'https://www.youtube.com/watch?v=short',
        'https://www.youtube.com/playlist?list=PL123',
        'http://www.youtube.com/watch?v=54JRejHOixA',
        'https://vimeo.com/123456',
      ]) {
        const record = validRecord();
        record.media[0].url = url;
        expect(errorsFor([record])).not.toEqual([]);
      }
    });

    it('rejects duplicate media URLs and alternative titles', () => {
      const media = validRecord();
      media.media.push({ ...media.media[0], position: 2 });
      expect(errorsFor([media]).join('\n')).toContain('duplicate URLs');

      const alts = validRecord({
        alternativeTitles: [
          { title: 'Paraná ê', position: 1 },
          { title: 'Paraná ê', position: 2 },
        ],
      });
      expect(errorsFor([alts]).join('\n')).toContain('duplicates');
    });

    it('rejects more than one primary rhythm and duplicate tags', () => {
      expect(
        errorsFor([
          validRecord({
            rhythms: [
              { slug: 'angola', isPrimary: true },
              { slug: 'iuna', isPrimary: true },
            ],
          }),
        ]).join('\n'),
      ).toContain('at most one rhythm');
      expect(
        errorsFor([validRecord({ tagSlugs: ['roda', 'roda'] })]).join('\n'),
      ).toContain('tagSlugs must not contain duplicates');
    });

    it('rejects over-long titles and texts instead of truncating them', () => {
      expect(errorsFor([validRecord({ title: 'x'.repeat(201) })])).not.toEqual(
        [],
      );
      expect(
        errorsFor([validRecord({ meaningTrivia: 'x'.repeat(10_001) })]),
      ).not.toEqual([]);
    });

    it('rejects two records sharing a normalized title across files', () => {
      const { errors } = validateSongImportDataset([
        file([validRecord()], 'a.json'),
        file(
          [validRecord({ title: 'PARANAUE', alternativeTitles: [] })],
          'b.json',
        ),
      ]);
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('b.json#1');
      expect(errors[0]).toContain('a.json#1');
    });

    it('rejects a title reused as another song alternative title', () => {
      const { errors } = validateSongImportDataset([
        file([
          validRecord(),
          validRecord({
            title: 'Outra',
            alternativeTitles: [{ title: 'Paranauê', position: 1 }],
          }),
        ]),
      ]);
      expect(errors.join('\n')).toContain('already used by');
    });

    it('allows accent-only variants within one song (search aliases)', () => {
      expect(
        errorsFor([
          validRecord({
            title: 'A Hora É Essa',
            alternativeTitles: [{ title: 'A Hora e Essa', position: 1 }],
          }),
        ]),
      ).toEqual([]);
    });
  });

  describe('translation quality and isUncertain', () => {
    const files = loadSongImportFiles(SONGS_DIRECTORY);
    const { entries } = validateSongImportDataset(files);
    const translations = entries.flatMap(({ record }) =>
      record.parts.flatMap((part) =>
        part.lines.flatMap((line) =>
          line.translations.map((translation) => ({ line, translation })),
        ),
      ),
    );

    it('has no editorial notes, placeholders or empty texts in the bundled dataset', () => {
      expect(translations).toHaveLength(1467);
      for (const { line, translation } of translations) {
        expect(translation.text.trim().length).toBeGreaterThan(0);
        expect(
          findEditorialNote(line.originalText, translation.text),
        ).toBeNull();
      }
    });

    it('flags exactly the 36 translations reviewed as uncertain, and only with true', () => {
      const raw = files.flatMap(
        ({ data }) =>
          (
            data as {
              songs: {
                parts: {
                  lines: { translations: Record<string, unknown>[] }[];
                }[];
              }[];
            }
          ).songs,
      );
      const rawFlags = raw.flatMap((song) =>
        song.parts.flatMap((part) =>
          part.lines.flatMap((line) =>
            line.translations
              .filter((t) => 'isUncertain' in t)
              .map((t) => t.isUncertain),
          ),
        ),
      );
      // The files only ever spell out `true` - absence means certain.
      expect(rawFlags).toEqual(Array(36).fill(true));
      expect(
        translations.filter(({ translation }) => translation.isUncertain),
      ).toHaveLength(36);
    });

    it('replaced the Paranauê placeholder with a flagged translation', () => {
      const paranaue = entries[0].record;
      const line = paranaue.parts[16].lines[0];
      expect(line.originalText).toBe('Assim dera que o morro, Paraná');
      expect(line.translations[0]).toEqual({
        languageCode: 'pl',
        text: 'I tak się stało, że wzgórze, Paraná',
        isUncertain: true,
      });
    });

    it('accepts isUncertain true/false and leaves it undefined when omitted', () => {
      const record = validRecord();
      record.parts[0].lines[0].translations[0] = {
        languageCode: 'pl',
        text: 'Powiem mojej żonie, Paraná',
        isUncertain: true,
      } as never;
      const parsed = songImportRecordSchema.parse(record);
      expect(parsed.parts[0].lines[0].translations[0].isUncertain).toBe(true);
      expect(
        parsed.parts[1].lines[0].translations[0].isUncertain,
      ).toBeUndefined();
    });

    it('rejects a non-boolean isUncertain', () => {
      const record = validRecord();
      record.parts[0].lines[0].translations[0] = {
        languageCode: 'pl',
        text: 'Powiem mojej żonie, Paraná',
        isUncertain: 'yes',
      } as never;
      expect(errorsFor([record]).join('\n')).toContain('isUncertain');
    });

    it.each([
      '[Wers niejasny — wymaga potwierdzenia oryginału]',
      'I zostań tutaj — dziękuję ci [sens niepewny]',
      'Iê (śpiewne zawołanie)',
      'Wyślę „loiá” — sens zawołania niepewny',
      'Lalauelauelauelaua — wokaliza',
      'Brak tłumaczenia',
    ])('rejects the editorial note "%s"', (text) => {
      const record = validRecord();
      record.parts[0].lines[0].translations[0].text = text;
      expect(errorsFor([record]).join('\n')).toContain(
        'use isUncertain and meaningContext/meaningTrivia instead',
      );
    });

    it('allows parentheses that mirror the original line', () => {
      expect(findEditorialNote('Ê (camará)', 'Ej (towarzyszu)')).toBeNull();
      expect(findEditorialNote('Ê camará', 'Ej, towarzyszu')).toBeNull();
    });
  });

  describe('extractYouTubeVideoId', () => {
    it.each([
      ['https://www.youtube.com/watch?v=-z6fpWzwx-Y', '-z6fpWzwx-Y'],
      ['https://youtu.be/54JRejHOixA', '54JRejHOixA'],
      ['https://m.youtube.com/watch?v=54JRejHOixA&t=30', '54JRejHOixA'],
      ['https://www.youtube.com/shorts/54JRejHOixA', '54JRejHOixA'],
      ['https://www.youtube.com/watch?v=54JRejHOix', null],
      ['https://www.youtube.com/channel/UC123', null],
      ['not a url', null],
    ])('%s -> %s', (url, expected) => {
      expect(extractYouTubeVideoId(url)).toBe(expected);
    });
  });
});
