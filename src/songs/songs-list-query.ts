import type { EntityManager, QueryBuilder } from '@mikro-orm/postgresql';
import { parseSortParam } from '../common/sorting/parse-sort-param';
import { SortDirection } from '../common/sorting/sorting.types';
import { ModerationQueueQuery } from './dto/moderation-queue-query.schema';
import {
  MY_SUBMISSION_STATUSES,
  MySubmissionsQuery,
} from './dto/my-submissions-query.schema';
import { ListSongsQuery } from './dto/song-list-query.schema';
import { Song } from './entities/song.entity';
import { SongStatus } from './enums/song-status.enum';

const SONG_SORT_FIELDS = ['title', 'createdAt', 'updatedAt'] as const;
type SongSortField = (typeof SONG_SORT_FIELDS)[number];

export interface SongListPage {
  ids: string[];
  totalItems: number;
}

/**
 * Builds and runs the id-only, paginated/sorted query behind GET /songs -
 * the public songbook. Every collection-shaped filter (search, tagIds,
 * hasPhonetics, hasMedia, hasTranslation/translationLanguage) is expressed
 * as a correlated EXISTS subquery against `s.id` rather than a JOIN, so the
 * `songs` table is never actually joined and no de-duplication step is
 * needed - see Etap 8.2 report section 22/38.
 */
export async function queryVisibleSongIds(
  em: EntityManager,
  currentUserId: string,
  query: ListSongsQuery,
): Promise<SongListPage> {
  const qb = em.createQueryBuilder(Song, 's').select('s.id');

  applyVisibility(qb);

  if (query.createdByMe) {
    qb.andWhere({ createdBy: currentUserId });
  }

  if (query.categoryId) {
    qb.andWhere({ category: query.categoryId });
  }

  if (query.search) {
    applySearch(qb, query.search);
  }

  if (query.tagIds && query.tagIds.length > 0) {
    applyTagFilter(qb, query.tagIds);
  }

  if (query.hasPhonetics !== undefined) {
    applyHasPhonetics(qb, query.hasPhonetics);
  }

  if (query.hasMedia !== undefined) {
    applyHasMedia(qb, query.hasMedia);
  }

  applyTranslationFilters(qb, query.hasTranslation, query.translationLanguage);

  const totalItems = await qb.clone().getCount();

  const sort = parseSortParam<SongSortField>({
    value: query.sort,
    allowedFields: SONG_SORT_FIELDS,
    defaultField: 'createdAt',
    defaultDirection: 'desc',
  });
  const offset = (query.page - 1) * query.limit;
  qb.orderBy(buildOrderBy(sort.field, sort.direction)).limit(
    query.limit,
    offset,
  );

  const rows = await qb.execute<{ id: string }[]>('all');
  return { ids: rows.map((row) => row.id), totalItems };
}

// The public songbook shows PUBLISHED content only - full stop, regardless
// of the caller's globalRole or any query param. A DRAFT/PENDING_REVIEW/
// REJECTED/HIDDEN song is never reachable through GET /songs or GET
// /songs/:id, not even for its own creator (see GET /songs/my-submissions)
// and not even for a MODERATOR+ (see GET /moderation/songs) - see the
// moderation model's central rule that only an approved Song is part of the
// songbook.
//
// Exported so other modules that need "is this song part of the public
// songbook" (e.g. rhythms/rhythm-song-links.query.ts, for a rhythm's related
// songs) reuse this exact rule instead of re-implementing it.
export function applyVisibility(qb: QueryBuilder<Song>): void {
  qb.andWhere({ status: SongStatus.PUBLISHED });
}

/**
 * Builds and runs the id-only, paginated query behind GET
 * /songs/my-submissions - the caller's own not-yet-(or no-longer-)public
 * songs (DRAFT/PENDING_REVIEW/REJECTED). PUBLISHED is deliberately excluded
 * (that's GET /songs) and so is HIDDEN (moderation history, not an
 * in-progress submission - see MY_SUBMISSION_STATUSES's own comment).
 * Deliberately simpler than queryVisibleSongIds - no search/tag/media
 * filters, just status + pagination, since this is a personal worklist, not
 * the full songbook browsing experience.
 */
export async function queryMySubmissionIds(
  em: EntityManager,
  userId: string,
  query: MySubmissionsQuery,
): Promise<SongListPage> {
  const statuses = query.status ? [query.status] : MY_SUBMISSION_STATUSES;

  const qb = em
    .createQueryBuilder(Song, 's')
    .select('s.id')
    .andWhere({ createdBy: userId, status: { $in: statuses } });

  const totalItems = await qb.clone().getCount();

  const offset = (query.page - 1) * query.limit;
  qb.orderBy({ createdAt: 'desc' }).limit(query.limit, offset);

  const rows = await qb.execute<{ id: string }[]>('all');
  return { ids: rows.map((row) => row.id), totalItems };
}

/**
 * Builds and runs the id-only, paginated query behind GET
 * /moderation/songs - every Song in the given status, regardless of who
 * created it (this is the one place ownership is deliberately NOT
 * filtered - see ModerationSongsController, CONTENT_APPROVE-gated).
 * Defaults to oldest-first (updatedAt ASC): submit()/reject() both bump
 * updatedAt (see BaseEntity), so it doubles as "time entered this status"
 * without a dedicated submittedAt/reviewedAt column, which is deliberately
 * not added yet - see the moderation model audit.
 */
export async function queryModerationQueueIds(
  em: EntityManager,
  query: ModerationQueueQuery,
): Promise<SongListPage> {
  const qb = em
    .createQueryBuilder(Song, 's')
    .select('s.id')
    .andWhere({ status: query.status });

  const totalItems = await qb.clone().getCount();

  const offset = (query.page - 1) * query.limit;
  qb.orderBy({ updatedAt: 'asc' }).limit(query.limit, offset);

  const rows = await qb.execute<{ id: string }[]>('all');
  return { ids: rows.map((row) => row.id), totalItems };
}

function applySearch(qb: QueryBuilder<Song>, search: string): void {
  const term = `%${search.toLowerCase()}%`;
  qb.andWhere(
    `(
      lower(s.title) like ?
      or lower(s.author_name) like ?
      or exists (
        select 1 from song_alternative_titles sat
        where sat.song_id = s.id and lower(sat.title) like ?
      )
      or exists (
        select 1 from song_lines sl
        inner join song_parts sp on sp.id = sl.part_id
        where sp.song_id = s.id and lower(sl.original_text) like ?
      )
    )`,
    [term, term, term, term],
  );
}

// AND semantics: the song must carry every listed tag (one EXISTS per tag).
function applyTagFilter(qb: QueryBuilder<Song>, tagIds: string[]): void {
  for (const tagId of tagIds) {
    qb.andWhere(
      `exists (select 1 from song_tags st where st.song_id = s.id and st.tag_id = ?)`,
      [tagId],
    );
  }
}

function applyHasPhonetics(
  qb: QueryBuilder<Song>,
  hasPhonetics: boolean,
): void {
  const existsSql = `exists (
    select 1 from song_line_phonetics slp
    inner join song_lines sl on sl.id = slp.line_id
    inner join song_parts sp on sp.id = sl.part_id
    where sp.song_id = s.id
  )`;
  qb.andWhere(hasPhonetics ? existsSql : `not ${existsSql}`);
}

function applyHasMedia(qb: QueryBuilder<Song>, hasMedia: boolean): void {
  const existsSql = `exists (select 1 from song_media sm where sm.song_id = s.id)`;
  qb.andWhere(hasMedia ? existsSql : `not ${existsSql}`);
}

function applyTranslationFilters(
  qb: QueryBuilder<Song>,
  hasTranslation: boolean | undefined,
  translationLanguage: string | undefined,
): void {
  if (translationLanguage) {
    const shouldHave = hasTranslation ?? true;
    const existsSql = `exists (
      select 1 from song_line_translations slt
      inner join song_lines sl on sl.id = slt.line_id
      inner join song_parts sp on sp.id = sl.part_id
      where sp.song_id = s.id and slt.language_code = ?
    )`;
    qb.andWhere(shouldHave ? existsSql : `not ${existsSql}`, [
      translationLanguage,
    ]);
    return;
  }

  if (hasTranslation !== undefined) {
    const existsSql = `exists (
      select 1 from song_line_translations slt
      inner join song_lines sl on sl.id = slt.line_id
      inner join song_parts sp on sp.id = sl.part_id
      where sp.song_id = s.id
    )`;
    qb.andWhere(hasTranslation ? existsSql : `not ${existsSql}`);
  }
}

function buildOrderBy(
  field: SongSortField,
  direction: SortDirection,
): Partial<Record<SongSortField, SortDirection>> {
  switch (field) {
    case 'title':
      return { title: direction };
    case 'createdAt':
      return { createdAt: direction };
    case 'updatedAt':
      return { updatedAt: direction };
  }
}

export interface SongSummaryAggregatesById {
  phoneticSongIds: Set<string>;
  mediaSongIds: Set<string>;
  translationLanguagesBySongId: Map<string, string[]>;
}

/**
 * Computes the three list-row aggregates (hasPhonetics, hasMedia,
 * translationLanguages) for a small, already-paginated set of song ids,
 * without ever loading the full parts/lines/translations/media trees.
 */
export async function loadSongSummaryAggregates(
  em: EntityManager,
  songIds: string[],
): Promise<SongSummaryAggregatesById> {
  if (songIds.length === 0) {
    return {
      phoneticSongIds: new Set(),
      mediaSongIds: new Set(),
      translationLanguagesBySongId: new Map(),
    };
  }

  const connection = em.getConnection();

  const [phoneticRows, mediaRows, translationRows] = await Promise.all([
    connection.execute<{ songId: string }[]>(
      `select distinct sp.song_id as "songId"
       from song_line_phonetics slp
       inner join song_lines sl on sl.id = slp.line_id
       inner join song_parts sp on sp.id = sl.part_id
       where sp.song_id in (?)`,
      [songIds],
    ),
    connection.execute<{ songId: string }[]>(
      `select distinct song_id as "songId" from song_media where song_id in (?)`,
      [songIds],
    ),
    connection.execute<{ songId: string; languages: string[] }[]>(
      `select sp.song_id as "songId", array_agg(distinct slt.language_code) as "languages"
       from song_line_translations slt
       inner join song_lines sl on sl.id = slt.line_id
       inner join song_parts sp on sp.id = sl.part_id
       where sp.song_id in (?)
       group by sp.song_id`,
      [songIds],
    ),
  ]);

  return {
    phoneticSongIds: new Set(phoneticRows.map((row) => row.songId)),
    mediaSongIds: new Set(mediaRows.map((row) => row.songId)),
    translationLanguagesBySongId: new Map(
      translationRows.map((row) => [row.songId, row.languages]),
    ),
  };
}
