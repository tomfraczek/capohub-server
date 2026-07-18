import type { EntityManager } from '@mikro-orm/postgresql';
import { toSongSummaryResponseDto } from '../songs/mappers/song.mapper';
import {
  applyVisibility,
  loadSongSummaryAggregates,
} from '../songs/songs-list-query';
import { Song } from '../songs/entities/song.entity';
import { RhythmSongRefDto } from './dto/rhythm-song-ref.dto';
import { SongRhythm } from './entities/song-rhythm.entity';

/**
 * Songs linked to one rhythm, restricted to whatever `currentUserId` may
 * see under the exact same visibility rule as GET /songs (see
 * applyVisibility in songs-list-query.ts) - used by the public
 * GET /rhythms/:slug endpoint. Never returns a song the caller couldn't
 * otherwise see (spec section 8).
 */
export async function loadVisibleSongsForRhythm(
  em: EntityManager,
  rhythmId: string,
  currentUserId: string,
): Promise<RhythmSongRefDto[]> {
  const qb = em
    .createQueryBuilder(Song, 's')
    .select('s.id')
    .andWhere(
      `exists (select 1 from song_rhythms sr where sr.song_id = s.id and sr.rhythm_id = ?)`,
      [rhythmId],
    )
    .orderBy({ title: 'asc' });
  applyVisibility(qb, currentUserId, undefined);

  const rows = await qb.execute<{ id: string }[]>('all');
  const songIds = rows.map((row) => row.id);

  return buildRhythmSongRefs(em, rhythmId, songIds);
}

/**
 * Every song linked to one rhythm, regardless of visibility - used by the
 * admin GET /admin/rhythms/:id endpoint, which needs full CMS visibility
 * into every existing songLink (spec section 10).
 */
export async function loadAllSongsForRhythm(
  em: EntityManager,
  rhythmId: string,
): Promise<RhythmSongRefDto[]> {
  const links = await em.find(SongRhythm, { rhythm: rhythmId });
  const songIds = links.map((link) => link.song.id);

  return buildRhythmSongRefs(em, rhythmId, songIds);
}

async function buildRhythmSongRefs(
  em: EntityManager,
  rhythmId: string,
  songIds: string[],
): Promise<RhythmSongRefDto[]> {
  if (songIds.length === 0) {
    return [];
  }

  const [songs, aggregates, links] = await Promise.all([
    em.find(
      Song,
      { id: { $in: songIds } },
      { populate: ['category', 'tags.tag', 'createdBy'] },
    ),
    loadSongSummaryAggregates(em, songIds),
    em.find(SongRhythm, { song: { $in: songIds }, rhythm: rhythmId }),
  ]);

  const songsById = new Map(songs.map((song) => [song.id, song]));
  const linkBySongId = new Map(links.map((link) => [link.song.id, link]));

  return songIds.flatMap((id) => {
    const song = songsById.get(id);
    const link = linkBySongId.get(id);
    if (!song || !link) {
      return [];
    }
    return [
      {
        ...toSongSummaryResponseDto(song, {
          hasPhonetics: aggregates.phoneticSongIds.has(id),
          hasMedia: aggregates.mediaSongIds.has(id),
          translationLanguages:
            aggregates.translationLanguagesBySongId.get(id) ?? [],
        }),
        isPrimary: link.isPrimary,
        relationDescription: link.description,
      },
    ];
  });
}
