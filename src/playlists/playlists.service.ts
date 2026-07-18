import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { UniqueConstraintViolationException } from '@mikro-orm/core';
import { EntityManager } from '@mikro-orm/postgresql';
import { Song } from '../songs/entities/song.entity';
import { loadSongSummaryAggregates } from '../songs/songs-list-query';
import { User } from '../users/entities/user.entity';
import { CreatePlaylistInput } from './dto/create-playlist.schema';
import { PlaylistResponseDto } from './dto/playlist-response.dto';
import { PlaylistSummaryResponseDto } from './dto/playlist-summary-response.dto';
import { SongPlaylistRefDto } from './dto/song-playlist-ref.dto';
import { UpdatePlaylistInput } from './dto/update-playlist.schema';
import { PlaylistSong } from './entities/playlist-song.entity';
import { Playlist } from './entities/playlist.entity';
import {
  toPlaylistResponseDto,
  toPlaylistSummaryResponseDto,
} from './mappers/playlist.mapper';

const DETAILS_POPULATE = [
  'songs.song.category',
  'songs.song.tags.tag',
  'songs.song.createdBy',
] as const;

@Injectable()
export class PlaylistsService {
  constructor(private readonly em: EntityManager) {}

  async list(userId: string): Promise<PlaylistSummaryResponseDto[]> {
    const playlists = await this.em.find(
      Playlist,
      { owner: userId },
      { orderBy: { createdAt: 'desc' } },
    );
    if (playlists.length === 0) {
      return [];
    }

    const counts = await this.em
      .getConnection()
      .execute<{ playlistId: string; count: number }[]>(
        `select playlist_id as "playlistId", count(*)::int as "count"
       from playlist_songs
       where playlist_id in (?)
       group by playlist_id`,
        [playlists.map((playlist) => playlist.id)],
      );
    const countsById = new Map(
      counts.map((row) => [row.playlistId, row.count]),
    );

    return playlists.map((playlist) =>
      toPlaylistSummaryResponseDto(playlist, countsById.get(playlist.id) ?? 0),
    );
  }

  async create(
    user: User,
    input: CreatePlaylistInput,
  ): Promise<PlaylistResponseDto> {
    const playlist = new Playlist();
    playlist.owner = user;
    playlist.name = input.name;
    playlist.description = input.description;
    await this.em.persist(playlist).flush();

    return this.getById(user.id, playlist.id);
  }

  async getById(
    userId: string,
    playlistId: string,
  ): Promise<PlaylistResponseDto> {
    const playlist = await this.em.findOne(
      Playlist,
      { id: playlistId, owner: userId },
      { populate: [...DETAILS_POPULATE] },
    );
    if (!playlist) {
      throw this.notFound();
    }

    const songIds = playlist.songs.getItems().map((item) => item.song.id);
    const aggregates = await loadSongSummaryAggregates(this.em, songIds);
    return toPlaylistResponseDto(playlist, aggregates);
  }

  async update(
    userId: string,
    playlistId: string,
    input: UpdatePlaylistInput,
  ): Promise<PlaylistResponseDto> {
    const playlist = await this.loadOwnedPlaylistOrFail(
      this.em,
      userId,
      playlistId,
    );

    if (input.name !== undefined) {
      playlist.name = input.name;
    }
    if (input.description !== undefined) {
      playlist.description = input.description;
    }
    await this.em.flush();

    return this.getById(userId, playlistId);
  }

  async delete(userId: string, playlistId: string): Promise<void> {
    const playlist = await this.loadOwnedPlaylistOrFail(
      this.em,
      userId,
      playlistId,
    );
    // DB-level ON DELETE CASCADE removes every playlist_songs row with this
    // single delete.
    await this.em.remove(playlist).flush();
  }

  // Idempotent: adding a song already in the playlist is a no-op - see
  // POST /playlists/:id/songs. New songs are appended at the end (max
  // position + 1).
  async addSong(
    userId: string,
    playlistId: string,
    songId: string,
  ): Promise<PlaylistResponseDto> {
    await this.em.transactional(async (em) => {
      const playlist = await this.loadOwnedPlaylistOrFail(
        em,
        userId,
        playlistId,
      );

      const song = await em.findOne(Song, { id: songId });
      if (!song) {
        throw new NotFoundException({
          code: 'SONG_NOT_FOUND',
          message: 'Song not found',
        });
      }

      const existing = await em.findOne(PlaylistSong, {
        playlist: playlistId,
        song: songId,
      });
      if (existing) {
        return;
      }

      const maxPositionRows = await em
        .getConnection()
        .execute<{ max: number | null }[]>(
          `select max(position) as "max" from playlist_songs where playlist_id = ?`,
          [playlistId],
        );
      const nextPosition = (maxPositionRows[0]?.max ?? 0) + 1;

      const playlistSong = new PlaylistSong();
      playlistSong.playlist = playlist;
      playlistSong.song = song;
      playlistSong.position = nextPosition;

      try {
        await em.persist(playlistSong).flush();
      } catch (error) {
        if (!(error instanceof UniqueConstraintViolationException)) {
          throw error;
        }
        // Race: the song was added by a concurrent request - the desired
        // end state (song is in the playlist) already holds.
      }
    });

    return this.getById(userId, playlistId);
  }

  // Idempotent: removing a song that isn't in the playlist is a no-op - see
  // DELETE /playlists/:id/songs/:songId. Deliberately doesn't renumber the
  // remaining positions - they stay a sparse but strictly ordered sequence,
  // which orderBy: { position: 'ASC' } handles the same either way.
  async removeSong(
    userId: string,
    playlistId: string,
    songId: string,
  ): Promise<PlaylistResponseDto> {
    await this.loadOwnedPlaylistOrFail(this.em, userId, playlistId);
    await this.em.nativeDelete(PlaylistSong, {
      playlist: playlistId,
      song: songId,
    });

    return this.getById(userId, playlistId);
  }

  // songIds must be exactly the set of songs currently in the playlist -
  // this reassigns every position, it does not move a single song.
  async reorderSongs(
    userId: string,
    playlistId: string,
    songIds: string[],
  ): Promise<PlaylistResponseDto> {
    await this.em.transactional(async (em) => {
      await this.loadOwnedPlaylistOrFail(em, userId, playlistId);

      const rows = await em.find(PlaylistSong, { playlist: playlistId });
      const currentIds = new Set(rows.map((row) => row.song.id));
      const requestedIds = new Set(songIds);

      const isExactMatch =
        currentIds.size === requestedIds.size &&
        songIds.length === rows.length &&
        [...currentIds].every((id) => requestedIds.has(id));

      if (!isExactMatch) {
        throw new ConflictException({
          code: 'PLAYLIST_ORDER_MISMATCH',
          message:
            'songIds must contain exactly the songs currently in the playlist, each exactly once',
        });
      }

      const rowBySongId = new Map(rows.map((row) => [row.song.id, row]));
      songIds.forEach((songId, index) => {
        const row = rowBySongId.get(songId);
        if (row) {
          row.position = index + 1;
        }
      });

      await em.flush();
    });

    return this.getById(userId, playlistId);
  }

  // Used by SongsService to populate SongDetails.playlists (spec section 5)
  // - only the current viewer's own playlists, never another user's.
  async getPlaylistsContainingSong(
    userId: string,
    songId: string,
  ): Promise<SongPlaylistRefDto[]> {
    const rows = await this.em.find(
      PlaylistSong,
      { song: songId, playlist: { owner: userId } },
      { populate: ['playlist'] },
    );

    return rows
      .map((row) => ({ id: row.playlist.id, name: row.playlist.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  private async loadOwnedPlaylistOrFail(
    em: EntityManager,
    userId: string,
    playlistId: string,
  ): Promise<Playlist> {
    const playlist = await em.findOne(Playlist, {
      id: playlistId,
      owner: userId,
    });
    if (!playlist) {
      throw this.notFound();
    }
    return playlist;
  }

  private notFound(): NotFoundException {
    return new NotFoundException({
      code: 'PLAYLIST_NOT_FOUND',
      message: 'Playlist not found',
    });
  }
}
