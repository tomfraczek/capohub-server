import type { EntityManager, QueryBuilder } from '@mikro-orm/postgresql';
import { parseSortParam } from '../common/sorting/parse-sort-param';
import { SortDirection } from '../common/sorting/sorting.types';
import { ListSongsQuery } from './dto/song-list-query.schema';
import { Song } from './entities/song.entity';
import { SongStatus } from './enums/song-status.enum';

const SONG_SORT_FIELDS = ['title', 'createdAt', 'updatedAt'] as const;
type SongSortField = (typeof SONG_SORT_FIELDS)[number];

const NON_PUBLISHED_STATUSES = [
  SongStatus.DRAFT,
  SongStatus.PENDING_REVIEW,
  SongStatus.REJECTED,
  SongStatus.HIDDEN,
];

export interface SongListPage {
  ids: string[];
  totalItems: number;
}

/**
 * Builds and runs the id-only, paginated/sorted query behind GET /songs.
 * Every collection-shaped filter (search, tagIds, hasPhonetics, hasMedia,
 * hasTranslation/translationLanguage) is expressed as a correlated EXISTS
 * subquery against `s.id` rather than a JOIN, so the `songs` table is never
 * actually joined and no de-duplication step is needed - see Etap 8.2
 * report section 22/38.
 */
export async function queryVisibleSongIds(
  em: EntityManager,
  currentUserId: string,
  query: ListSongsQuery,
): Promise<SongListPage> {
  const qb = em.createQueryBuilder(Song, 's').select('s.id');

  applyVisibility(qb, currentUserId, query.status);

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

// PUBLISHED is visible to everyone; every other status is visible only to
// the song's own createdBy. This is a deliberately temporary, hard-coded
// rule (see Etap 8.2 report) pending the PermissionService-based visibility
// that will ship with moderator roles.
//
// Exported so other modules that need "is this song visible to this user"
// (e.g. rhythms/rhythm-song-links.query.ts, for a rhythm's related songs)
// reuse this exact rule instead of re-implementing it - see spec section 8.
export function applyVisibility(
  qb: QueryBuilder<Song>,
  currentUserId: string,
  statusFilter: SongStatus | undefined,
): void {
  if (statusFilter) {
    if (statusFilter === SongStatus.PUBLISHED) {
      qb.andWhere({ status: SongStatus.PUBLISHED });
    } else {
      qb.andWhere({ status: statusFilter, createdBy: currentUserId });
    }
    return;
  }

  qb.andWhere({
    $or: [
      { status: SongStatus.PUBLISHED },
      { status: { $in: NON_PUBLISHED_STATUSES }, createdBy: currentUserId },
    ],
  });
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
    select 1 from song_lines sl
    inner join song_parts sp on sp.id = sl.part_id
    where sp.song_id = s.id
      and sl.phonetic_text is not null
      and length(trim(sl.phonetic_text)) > 0
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
       from song_lines sl
       inner join song_parts sp on sp.id = sl.part_id
       where sp.song_id in (?)
         and sl.phonetic_text is not null
         and length(trim(sl.phonetic_text)) > 0`,
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
