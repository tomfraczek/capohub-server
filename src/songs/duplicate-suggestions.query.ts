import type { EntityManager } from '@mikro-orm/postgresql';
import { Song } from './entities/song.entity';
import { SongStatus } from './enums/song-status.enum';
import { normalizeSongDuplicateText } from './song-duplicate.utils';

// SQL-side prefilter cap (spec section 7) - similarity scoring in
// song-duplicate.service.ts only ever runs on this many rows, never the
// whole table.
const MAX_CANDIDATES = 50;

// Folds the common Portuguese/Spanish accented letters to their plain ASCII
// form directly in SQL, using the built-in translate() function - no
// unaccent/pg_trgm extension required. This is deliberately a smaller,
// hand-picked subset of what normalizeSongDuplicateText does in TypeScript
// (which uses full Unicode NFD decomposition): it only needs to be good
// enough to keep an accented title inside the LIKE prefilter's candidate
// set. The precise, general-purpose comparison happens afterwards in
// song-duplicate.service.ts, on the already-narrowed candidates.
const ACCENTED_CHARS = 'áàãâäéèêëíìîïóòõôöúùûüçñ';
const PLAIN_CHARS = 'aaaaaeeeeiiiiooooouuuucn';

// Narrower than GET /songs' general visibility rule (which also shows the
// user's own HIDDEN songs): a hidden song was explicitly taken down and
// should not resurface as a "this already exists" duplicate warning - see
// spec section 4/14.
const OWN_ONLY_STATUSES = [SongStatus.DRAFT, SongStatus.REJECTED];
const GLOBALLY_VISIBLE_STATUSES = [
  SongStatus.PUBLISHED,
  SongStatus.PENDING_REVIEW,
];

export interface DuplicateCandidateRow {
  id: string;
  title: string;
  status: SongStatus;
  firstLine: string | null;
}

export interface DuplicateCandidateQueryParams {
  currentUserId: string;
  // Raw (not pre-normalized) search term - normalizeSongDuplicateText is
  // applied internally before it's used in the SQL LIKE pattern.
  searchTerm: string;
  excludeSongId?: string;
}

/**
 * Finds up to MAX_CANDIDATES visible songs whose title loosely matches
 * searchTerm, plus (in one extra query, never per-row) each candidate's
 * first non-empty lyric line. The visibility filter is applied in the SQL
 * WHERE clause itself, not after fetching, so a caller can never receive a
 * candidate it isn't allowed to see (spec section 18).
 */
export async function queryDuplicateCandidates(
  em: EntityManager,
  { currentUserId, searchTerm, excludeSongId }: DuplicateCandidateQueryParams,
): Promise<DuplicateCandidateRow[]> {
  const normalizedTerm = normalizeSongDuplicateText(searchTerm);

  const qb = em
    .createQueryBuilder(Song, 's')
    .select(['s.id', 's.title', 's.status'])
    .andWhere({
      $or: [
        { status: { $in: GLOBALLY_VISIBLE_STATUSES } },
        { status: { $in: OWN_ONLY_STATUSES }, createdBy: currentUserId },
      ],
    })
    .andWhere(`translate(lower(s.title), ?, ?) like ?`, [
      ACCENTED_CHARS,
      PLAIN_CHARS,
      `%${normalizedTerm}%`,
    ])
    .orderBy({ title: 'asc' })
    .limit(MAX_CANDIDATES);

  if (excludeSongId) {
    qb.andWhere({ id: { $ne: excludeSongId } });
  }

  const rows =
    await qb.execute<{ id: string; title: string; status: SongStatus }[]>(
      'all',
    );

  if (rows.length === 0) {
    return [];
  }

  const firstLinesById = await loadFirstLines(
    em,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    status: row.status,
    firstLine: firstLinesById.get(row.id) ?? null,
  }));
}

// One query for every candidate's first non-empty line, using
// `distinct on` + a matching `order by` to pick the row with the smallest
// (part.position, line.position) per song - i.e. exactly the first lyric
// line, per spec section 8. Mirrors the batching pattern already used by
// loadSongSummaryAggregates in songs-list-query.ts.
async function loadFirstLines(
  em: EntityManager,
  songIds: string[],
): Promise<Map<string, string>> {
  const connection = em.getConnection();
  const rows = await connection.execute<
    { songId: string; firstLine: string }[]
  >(
    `select distinct on (sp.song_id) sp.song_id as "songId", sl.original_text as "firstLine"
     from song_lines sl
     inner join song_parts sp on sp.id = sl.part_id
     where sp.song_id in (?)
       and sl.original_text is not null
       and length(trim(sl.original_text)) > 0
     order by sp.song_id, sp.position asc, sl.position asc`,
    [songIds],
  );

  return new Map(rows.map((row) => [row.songId, row.firstLine]));
}
