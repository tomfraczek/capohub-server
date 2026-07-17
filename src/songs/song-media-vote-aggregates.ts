import type { EntityManager } from '@mikro-orm/postgresql';

export interface SongMediaVoteAggregates {
  voteCountsByMediaId: Map<string, number>;
  // The single media id the given user voted for within this song, or null
  // if they haven't voted (or no user was asked about) - a user can only
  // ever have one vote per song, see SongMediaVote's song+user unique
  // constraint.
  votedMediaId: string | null;
}

/**
 * Computes vote aggregates for every SongMedia row of one song in at most
 * two small queries (never per-media), so GET /songs/:id stays free of
 * N+1s regardless of how many media links a song has.
 */
export async function loadSongMediaVoteAggregates(
  em: EntityManager,
  songId: string,
  currentUserId: string | null,
): Promise<SongMediaVoteAggregates> {
  const connection = em.getConnection();

  const [countRows, votedRows] = await Promise.all([
    connection.execute<{ mediaId: string; voteCount: number }[]>(
      `select media_id as "mediaId", count(*)::int as "voteCount"
       from song_media_votes
       where song_id = ?
       group by media_id`,
      [songId],
    ),
    currentUserId
      ? connection.execute<{ mediaId: string }[]>(
          `select media_id as "mediaId"
           from song_media_votes
           where song_id = ? and user_id = ?`,
          [songId, currentUserId],
        )
      : Promise.resolve([]),
  ]);

  return {
    voteCountsByMediaId: new Map(
      countRows.map((row) => [row.mediaId, row.voteCount]),
    ),
    votedMediaId: votedRows[0]?.mediaId ?? null,
  };
}
