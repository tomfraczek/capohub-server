import { Injectable, NotFoundException } from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
// Not a type-only import: createQueryBuilder is used indirectly through the
// reused songs-list aggregates helper - see loadSongSummaryAggregates.
import { EntityManager } from '@mikro-orm/postgresql';
import { toSongSummaryResponseDto } from '../songs/mappers/song.mapper';
import { loadSongSummaryAggregates } from '../songs/songs-list-query';
import { Song } from '../songs/entities/song.entity';
import { User } from '../users/entities/user.entity';
import { FavoriteSongListItemDto } from './dto/favorite-songs-list-response.dto';
import { FavoriteSong } from './entities/favorite-song.entity';

@Injectable()
export class FavoriteSongsService {
  constructor(private readonly em: EntityManager) {}

  // Idempotent: favoriting an already-favorited song is a no-op, not a
  // conflict - see POST /songs/:songId/favorite.
  async addFavorite(user: User, songId: string): Promise<void> {
    await this.assertSongExists(songId);

    const existing = await this.em.findOne(FavoriteSong, {
      user: user.id,
      song: songId,
    });
    if (existing) {
      return;
    }

    const favorite = new FavoriteSong();
    favorite.user = user;
    favorite.song = this.em.getReference(Song, songId);

    try {
      await this.em.persist(favorite).flush();
    } catch (error) {
      // Race: two concurrent first-favorites for the same user+song. The
      // unique constraint is what actually prevents the duplicate row; if we
      // lost the race the other request already put us in the desired end
      // state, so this is a no-op rather than an error.
      if (!(error instanceof UniqueConstraintViolationException)) {
        throw error;
      }
    }
  }

  // Idempotent: unfavoriting a song that isn't favorited is a no-op (204
  // either way) - see DELETE /songs/:songId/favorite.
  async removeFavorite(userId: string, songId: string): Promise<void> {
    await this.em.nativeDelete(FavoriteSong, { user: userId, song: songId });
  }

  async isFavorite(userId: string, songId: string): Promise<boolean> {
    const count = await this.em.count(FavoriteSong, {
      user: userId,
      song: songId,
    });
    return count > 0;
  }

  // Reuses the exact same SongSummaryResponseDto shape/aggregates as GET
  // /songs, so the frontend gets a consistent song card regardless of which
  // list it came from - see toSongSummaryResponseDto / loadSongSummaryAggregates.
  async listFavoriteSongs(userId: string): Promise<FavoriteSongListItemDto[]> {
    const favorites = await this.em.find(
      FavoriteSong,
      { user: userId },
      { orderBy: { createdAt: 'desc' } },
    );
    if (favorites.length === 0) {
      return [];
    }

    const songIds = favorites.map((favorite) => favorite.song.id);
    const [songs, aggregates] = await Promise.all([
      this.em.find(
        Song,
        { id: { $in: songIds } },
        { populate: ['category', 'tags.tag', 'createdBy'] },
      ),
      loadSongSummaryAggregates(this.em, songIds),
    ]);
    const songsById = new Map(songs.map((song) => [song.id, song]));

    return favorites.flatMap((favorite) => {
      const song = songsById.get(favorite.song.id);
      if (!song) {
        return [];
      }
      return [
        {
          ...toSongSummaryResponseDto(song, {
            hasPhonetics: aggregates.phoneticSongIds.has(song.id),
            hasMedia: aggregates.mediaSongIds.has(song.id),
            translationLanguages:
              aggregates.translationLanguagesBySongId.get(song.id) ?? [],
          }),
          favoritedAt: favorite.createdAt.toISOString(),
        },
      ];
    });
  }

  private async assertSongExists(songId: string): Promise<void> {
    const exists = await this.em.count(Song, { id: songId });
    if (exists === 0) {
      throw new NotFoundException({
        code: 'SONG_NOT_FOUND',
        message: 'Song not found',
      });
    }
  }
}
