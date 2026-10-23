import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Rhythm } from '../../../rhythms/entities/rhythm.entity';
import { SongRhythm } from '../../../rhythms/entities/song-rhythm.entity';
import { CreateSongInput } from '../../../songs/dto/create-song.schema';
import { SongCategory } from '../../../songs/entities/song-category.entity';
import { Song } from '../../../songs/entities/song.entity';
import { Tag } from '../../../songs/entities/tag.entity';
import { SongStatus } from '../../../songs/enums/song-status.enum';
import { SongContentService } from '../../../songs/song-content.service';
import { normalizeSongDuplicateText } from '../../../songs/song-duplicate.utils';
import {
  collectNormalizedNames,
  REQUIRED_TRANSLATION_LANGUAGES,
  SongImportEntry,
  SongImportFileContent,
  SongImportRecord,
} from './song-import.schema';
import {
  diffSnapshots,
  normalizedFirstLine,
  SONG_SNAPSHOT_POPULATE,
  snapshotFromRecord,
  snapshotFromSong,
  SongContentSnapshot,
} from './song-import.snapshot';

export enum SongImportStatus {
  // Inserted by this run (or, with dryRun, would be).
  CREATED = 'CREATED',
  WOULD_CREATE = 'WOULD_CREATE',
  // A song with exactly this content already exists - nothing to do.
  UNCHANGED = 'UNCHANGED',
  // The same song (same title + first line) exists, but its content
  // differs from the file - most likely edited in the app since a previous
  // import. Never overwritten automatically.
  SKIPPED_MODIFIED = 'SKIPPED_MODIFIED',
  // A song with the same (alternative) title but different lyrics exists -
  // possibly a genuinely different song, possibly the same one heavily
  // edited. Ambiguous, so left for a human to decide.
  SKIPPED_TITLE_COLLISION = 'SKIPPED_TITLE_COLLISION',
  // Writing this record failed; its transaction was rolled back.
  FAILED = 'FAILED',
}

export interface SongImportResult {
  source: string;
  title: string;
  status: SongImportStatus;
  songId: string | null;
  detail: string | null;
  differences: string[];
}

export interface SongImportOptions {
  dryRun?: boolean;
}

/**
 * Thrown before anything is written when the files reference a category,
 * tag or rhythm that doesn't exist (or isn't active) in this database.
 */
export class SongImportReferenceError extends Error {
  constructor(readonly problems: string[]) {
    super(`Unresolvable import references:\n- ${problems.join('\n- ')}`);
    this.name = 'SongImportReferenceError';
  }
}

export interface SongImportReferences {
  categoryIdsByCode: Map<string, string>;
  tagIdsBySlug: Map<string, string>;
  rhythmIdsBySlug: Map<string, string>;
}

export interface ExistingSongCandidate {
  songId: string;
  status: SongStatus;
  snapshot: SongContentSnapshot;
}

export type ImportDecision =
  | { action: 'CREATE' }
  | {
      action: 'SKIP';
      status:
        | SongImportStatus.UNCHANGED
        | SongImportStatus.SKIPPED_MODIFIED
        | SongImportStatus.SKIPPED_TITLE_COLLISION;
      songId: string | null;
      detail: string | null;
      differences: string[];
    };

/** Reads every *.json file of `directory`, in file-name order. */
export function loadSongImportFiles(
  directory: string,
): SongImportFileContent[] {
  return readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith('.json'))
    .sort()
    .map((fileName) => {
      const raw = readFileSync(join(directory, fileName), 'utf8');
      try {
        return { fileName, data: JSON.parse(raw) as unknown };
      } catch (error) {
        throw new Error(
          `${fileName} is not valid JSON: ${(error as Error).message}`,
        );
      }
    });
}

/**
 * Resolves every categoryCode/tagSlug/rhythm slug the entries use to an
 * active database row. Collects all problems first and throws them
 * together, so a single run reports everything that needs fixing.
 */
export async function resolveSongImportReferences(
  em: EntityManager,
  entries: SongImportEntry[],
): Promise<SongImportReferences> {
  const categoryCodes = unique(entries.map((e) => e.record.categoryCode));
  const tagSlugs = unique(entries.flatMap((e) => e.record.tagSlugs));
  const rhythmSlugs = unique(
    entries.flatMap((e) => e.record.rhythms.map((r) => r.slug)),
  );

  const [categories, tags, rhythms] = await Promise.all([
    em.find(SongCategory, { code: { $in: categoryCodes }, isActive: true }),
    tagSlugs.length > 0
      ? em.find(Tag, { slug: { $in: tagSlugs }, isActive: true })
      : Promise.resolve([]),
    rhythmSlugs.length > 0
      ? em.find(Rhythm, { slug: { $in: rhythmSlugs }, isActive: true })
      : Promise.resolve([]),
  ]);

  const references: SongImportReferences = {
    categoryIdsByCode: new Map(categories.map((c) => [c.code, c.id])),
    tagIdsBySlug: new Map(tags.map((t) => [t.slug, t.id])),
    rhythmIdsBySlug: new Map(rhythms.map((r) => [r.slug, r.id])),
  };

  const problems = [
    ...missing(categoryCodes, references.categoryIdsByCode).map(
      (code) => `category "${code}" does not exist or is inactive`,
    ),
    ...missing(tagSlugs, references.tagIdsBySlug).map(
      (slug) => `tag "${slug}" does not exist or is inactive`,
    ),
    ...missing(rhythmSlugs, references.rhythmIdsBySlug).map(
      (slug) => `rhythm "${slug}" does not exist or is inactive`,
    ),
  ];
  if (problems.length > 0) {
    throw new SongImportReferenceError(problems);
  }

  return references;
}

/**
 * Pure decision for one record, given every existing song that shares one
 * of its (normalized) titles/alternative titles:
 *  - identical content already exists  -> UNCHANGED
 *  - same title + same first line, other content differs -> SKIPPED_MODIFIED
 *    (never overwrite what users may have edited since)
 *  - only a title/alt-title overlap -> SKIPPED_TITLE_COLLISION (ambiguous)
 *  - no overlap at all -> CREATE
 */
export function decideImportAction(
  expected: SongContentSnapshot,
  candidates: ExistingSongCandidate[],
): ImportDecision {
  const identical = candidates.find(
    (candidate) => diffSnapshots(expected, candidate.snapshot).length === 0,
  );
  if (identical) {
    return {
      action: 'SKIP',
      status: SongImportStatus.UNCHANGED,
      songId: identical.songId,
      detail: null,
      differences: [],
    };
  }

  const expectedTitle = normalizeSongDuplicateText(expected.title);
  const expectedFirstLine = normalizedFirstLine(expected);
  const sameSong = candidates.find(
    (candidate) =>
      normalizeSongDuplicateText(candidate.snapshot.title) === expectedTitle &&
      normalizedFirstLine(candidate.snapshot) === expectedFirstLine,
  );
  if (sameSong) {
    return {
      action: 'SKIP',
      status: SongImportStatus.SKIPPED_MODIFIED,
      songId: sameSong.songId,
      detail: `existing song ${sameSong.songId} (${sameSong.status}) differs from the file and was left untouched`,
      differences: diffSnapshots(expected, sameSong.snapshot),
    };
  }

  if (candidates.length > 0) {
    return {
      action: 'SKIP',
      status: SongImportStatus.SKIPPED_TITLE_COLLISION,
      songId: null,
      detail: `shares a title with existing song(s) ${candidates
        .map((c) => `${c.songId} "${c.snapshot.title}" (${c.status})`)
        .join(', ')} but has different lyrics - review manually`,
      differences: [],
    };
  }

  return { action: 'CREATE' };
}

/**
 * Imports `entries` (already validated - see validateSongImportDataset)
 * as PUBLISHED catalogue songs. Idempotent: every record is first matched
 * against existing songs (decideImportAction) and only ever inserted,
 * never updated or deleted. Each insert runs in its own transaction, so a
 * failing record leaves no partial song behind and doesn't block the
 * others. References are resolved up front - if any is missing, nothing
 * is written at all.
 */
export async function importSongs(
  em: EntityManager,
  contentService: SongContentService,
  entries: SongImportEntry[],
  options: SongImportOptions = {},
): Promise<SongImportResult[]> {
  const references = await resolveSongImportReferences(em.fork(), entries);
  const nameIndex = await loadExistingNameIndex(em);
  const results: SongImportResult[] = [];

  for (const entry of entries) {
    const base = { source: entry.source, title: entry.record.title };
    const expected = snapshotFromRecord(entry.record);
    const candidates = await loadCandidates(
      em.fork(),
      candidateIdsFor(nameIndex, entry.record),
    );
    const decision = decideImportAction(expected, candidates);

    if (decision.action === 'SKIP') {
      results.push({ ...base, ...omitAction(decision) });
      continue;
    }

    if (options.dryRun) {
      results.push({
        ...base,
        status: SongImportStatus.WOULD_CREATE,
        songId: null,
        detail: null,
        differences: [],
      });
      continue;
    }

    try {
      const songId = await createImportedSong(
        em.fork(),
        contentService,
        entry.record,
        references,
      );
      for (const name of collectNormalizedNames(entry.record)) {
        addToIndex(nameIndex, name, songId);
      }
      results.push({
        ...base,
        status: SongImportStatus.CREATED,
        songId,
        detail: null,
        differences: [],
      });
    } catch (error) {
      results.push({
        ...base,
        status: SongImportStatus.FAILED,
        songId: null,
        detail: error instanceof Error ? error.message : String(error),
        differences: [],
      });
    }
  }

  return results;
}

async function createImportedSong(
  em: EntityManager,
  contentService: SongContentService,
  record: SongImportRecord,
  references: SongImportReferences,
): Promise<string> {
  return em.transactional(async (tem) => {
    const { categoryCode, tagSlugs, rhythms, ...content } = record;
    const input: CreateSongInput = {
      ...content,
      categoryId: references.categoryIdsByCode.get(categoryCode)!,
      tagIds: tagSlugs.map((slug) => references.tagIdsBySlug.get(slug)!),
    };

    // Curated catalogue content: published straight away and attributed
    // to no CapoHub user (createdBy null - same as an author-deleted song).
    const song = new Song();
    song.status = SongStatus.PUBLISHED;
    song.createdBy = null;
    await contentService.replaceContent(tem, song, input, null);

    for (const link of rhythms) {
      const songRhythm = new SongRhythm();
      songRhythm.song = song;
      songRhythm.rhythm = tem.getReference(
        Rhythm,
        references.rhythmIdsBySlug.get(link.slug)!,
      );
      songRhythm.isPrimary = link.isPrimary;
      songRhythm.description = link.description;
      tem.persist(songRhythm);
    }
    await tem.flush();

    return song.id;
  });
}

export interface SongImportDbCounts {
  parts: number;
  lines: number;
  translations: number;
  media: number;
  alternativeTitles: number;
}

export interface SongVerificationResult {
  source: string;
  title: string;
  songId: string | null;
  categoryCode: string;
  authorName: string | null;
  expected: SongImportDbCounts;
  actual: SongImportDbCounts | null;
  problems: string[];
}

export interface SongImportVerification {
  songs: SongVerificationResult[];
  integrityProblems: string[];
  ok: boolean;
}

/**
 * Re-reads the database and compares it to the source records - never
 * trusts the import's own result. For every record there must be exactly
 * one PUBLISHED song with byte-identical content (full snapshot diff), and
 * the raw SQL row counts of its parts/lines/translations/media/alternative
 * titles must match the file. Also checks the whole song subtree for rows
 * whose parent is missing.
 */
export async function verifyImportedSongs(
  em: EntityManager,
  entries: SongImportEntry[],
): Promise<SongImportVerification> {
  const nameIndex = await loadExistingNameIndex(em);
  const songs: SongVerificationResult[] = [];

  for (const entry of entries) {
    const expectedSnapshot = snapshotFromRecord(entry.record);
    const candidates = await loadCandidates(
      em.fork(),
      candidateIdsFor(nameIndex, entry.record),
    );
    const identical = candidates.filter(
      (c) => diffSnapshots(expectedSnapshot, c.snapshot).length === 0,
    );
    const problems: string[] = [];
    const match = identical.length === 1 ? identical[0] : null;

    if (identical.length === 0) {
      const decision = decideImportAction(expectedSnapshot, candidates);
      problems.push('no song with identical content found');
      if (decision.action === 'SKIP') {
        problems.push(...decision.differences);
      }
    } else if (identical.length > 1) {
      problems.push(
        `found ${identical.length} songs with identical content (duplicates): ${identical
          .map((c) => c.songId)
          .join(', ')}`,
      );
    }

    if (match && match.status !== SongStatus.PUBLISHED) {
      problems.push(`status is ${match.status}, expected PUBLISHED`);
    }

    const expected = countRecord(entry.record);
    const actual = match ? await countSongRows(em, match.songId) : null;
    if (actual) {
      for (const key of Object.keys(expected) as (keyof SongImportDbCounts)[]) {
        if (expected[key] !== actual[key]) {
          problems.push(
            `${key}: expected ${expected[key]} row(s), found ${actual[key]}`,
          );
        }
      }
    }

    songs.push({
      source: entry.source,
      title: entry.record.title,
      songId: match?.songId ?? null,
      categoryCode: entry.record.categoryCode,
      authorName: entry.record.authorName,
      expected,
      actual,
      problems,
    });
  }

  const integrityProblems = await findOrphanedSongRows(em);

  return {
    songs,
    integrityProblems,
    ok:
      integrityProblems.length === 0 &&
      songs.every((song) => song.problems.length === 0),
  };
}

export function countRecord(record: SongImportRecord): SongImportDbCounts {
  const lines = record.parts.flatMap((part) => part.lines);
  return {
    parts: record.parts.length,
    lines: lines.length,
    translations: lines.reduce(
      (sum, line) =>
        sum +
        line.translations.filter((t) =>
          (REQUIRED_TRANSLATION_LANGUAGES as readonly string[]).includes(
            t.languageCode,
          ),
        ).length,
      0,
    ),
    media: record.media.length,
    alternativeTitles: record.alternativeTitles.length,
  };
}

async function countSongRows(
  em: EntityManager,
  songId: string,
): Promise<SongImportDbCounts> {
  const [row] = await em
    .getConnection()
    .execute<Record<keyof SongImportDbCounts, string>[]>(
      `select
       (select count(*) from song_parts sp where sp.song_id = ?) as "parts",
       (select count(*) from song_lines sl
          inner join song_parts sp on sp.id = sl.part_id
          where sp.song_id = ?) as "lines",
       (select count(*) from song_line_translations slt
          inner join song_lines sl on sl.id = slt.line_id
          inner join song_parts sp on sp.id = sl.part_id
          where sp.song_id = ? and slt.language_code in (?)) as "translations",
       (select count(*) from song_media sm where sm.song_id = ?) as "media",
       (select count(*) from song_alternative_titles sat
          where sat.song_id = ?) as "alternativeTitles"`,
      [
        songId,
        songId,
        songId,
        [...REQUIRED_TRANSLATION_LANGUAGES],
        songId,
        songId,
      ],
    );

  return {
    parts: Number(row.parts),
    lines: Number(row.lines),
    translations: Number(row.translations),
    media: Number(row.media),
    alternativeTitles: Number(row.alternativeTitles),
  };
}

// The FK constraints already make these impossible - checked anyway,
// since the verification is meant to read the real state, not assume it.
const ORPHAN_CHECKS: { label: string; sql: string }[] = [
  {
    label: 'song_parts without a song',
    sql: `select count(*) as "count" from song_parts sp left join songs s on s.id = sp.song_id where s.id is null`,
  },
  {
    label: 'song_lines without a part',
    sql: `select count(*) as "count" from song_lines sl left join song_parts sp on sp.id = sl.part_id where sp.id is null`,
  },
  {
    label: 'song_line_translations without a line',
    sql: `select count(*) as "count" from song_line_translations slt left join song_lines sl on sl.id = slt.line_id where sl.id is null`,
  },
  {
    label: 'song_media without a song',
    sql: `select count(*) as "count" from song_media sm left join songs s on s.id = sm.song_id where s.id is null`,
  },
  {
    label: 'song_alternative_titles without a song',
    sql: `select count(*) as "count" from song_alternative_titles sat left join songs s on s.id = sat.song_id where s.id is null`,
  },
  {
    label: 'songs without a category',
    sql: `select count(*) as "count" from songs s left join song_categories c on c.id = s.category_id where c.id is null`,
  },
  {
    label: 'song parts without any line',
    sql: `select count(*) as "count" from song_parts sp where not exists (select 1 from song_lines sl where sl.part_id = sp.id)`,
  },
];

async function findOrphanedSongRows(em: EntityManager): Promise<string[]> {
  const connection = em.getConnection();
  const problems: string[] = [];
  for (const check of ORPHAN_CHECKS) {
    const [row] = await connection.execute<{ count: string }[]>(check.sql);
    if (Number(row.count) > 0) {
      problems.push(`${row.count} ${check.label}`);
    }
  }
  return problems;
}

// normalized title/alternative title -> ids of songs carrying it. Built
// once per run from plain id/title rows (cheap even for a large catalogue)
// rather than a SQL LIKE prefilter, so the exact same normalization as the
// duplicate detection applies on both sides.
export type NameIndex = Map<string, Set<string>>;

export async function loadExistingNameIndex(
  em: EntityManager,
): Promise<NameIndex> {
  const connection = em.getConnection();
  const [titles, alternativeTitles] = await Promise.all([
    connection.execute<{ songId: string; title: string }[]>(
      `select id as "songId", title from songs`,
    ),
    connection.execute<{ songId: string; title: string }[]>(
      `select song_id as "songId", title from song_alternative_titles`,
    ),
  ]);

  const index: NameIndex = new Map();
  for (const row of [...titles, ...alternativeTitles]) {
    addToIndex(index, normalizeSongDuplicateText(row.title), row.songId);
  }
  return index;
}

function addToIndex(index: NameIndex, name: string, songId: string): void {
  const ids = index.get(name) ?? new Set<string>();
  ids.add(songId);
  index.set(name, ids);
}

export function candidateIdsFor(
  index: NameIndex,
  record: SongImportRecord,
): string[] {
  const ids = new Set<string>();
  for (const name of collectNormalizedNames(record)) {
    for (const id of index.get(name) ?? []) {
      ids.add(id);
    }
  }
  return [...ids];
}

export async function loadCandidates(
  em: EntityManager,
  songIds: string[],
): Promise<ExistingSongCandidate[]> {
  if (songIds.length === 0) {
    return [];
  }

  const [songs, rhythmLinks] = await Promise.all([
    em.find(
      Song,
      { id: { $in: songIds } },
      { populate: [...SONG_SNAPSHOT_POPULATE] },
    ),
    em.find(SongRhythm, { song: { $in: songIds } }, { populate: ['rhythm'] }),
  ]);

  return songs.map((song) => ({
    songId: song.id,
    status: song.status,
    snapshot: snapshotFromSong(
      song,
      rhythmLinks.filter((link) => link.song.id === song.id),
    ),
  }));
}

function omitAction(
  decision: Extract<ImportDecision, { action: 'SKIP' }>,
): Omit<SongImportResult, 'source' | 'title'> {
  return {
    status: decision.status,
    songId: decision.songId,
    detail: decision.detail,
    differences: decision.differences,
  };
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function missing(values: string[], found: Map<string, string>): string[] {
  return values.filter((value) => !found.has(value));
}
