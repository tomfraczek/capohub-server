import { toSongSummaryResponseDto } from '../../songs/mappers/song.mapper';
import { SongSummaryAggregatesById } from '../../songs/songs-list-query';
import {
  PlaylistResponseDto,
  PlaylistSongItemDto,
} from '../dto/playlist-response.dto';
import { PlaylistSummaryResponseDto } from '../dto/playlist-summary-response.dto';
import { Playlist } from '../entities/playlist.entity';

export function toPlaylistSummaryResponseDto(
  playlist: Playlist,
  songCount: number,
): PlaylistSummaryResponseDto {
  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    songCount,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
  };
}

/**
 * Maps a Playlist with `songs` (+ each song's category/tags.tag/createdBy)
 * populated, plus separately-computed song aggregates, to the full details
 * shape for GET/POST/PATCH /playlists/:id. `songs` is already ordered by
 * `position` at the ORM level (see Playlist.songs' orderBy option).
 */
export function toPlaylistResponseDto(
  playlist: Playlist,
  songAggregates: SongSummaryAggregatesById,
): PlaylistResponseDto {
  const songs: PlaylistSongItemDto[] = playlist.songs
    .getItems()
    .map((playlistSong) => ({
      id: playlistSong.id,
      position: playlistSong.position,
      song: toSongSummaryResponseDto(playlistSong.song, {
        hasPhonetics: songAggregates.phoneticSongIds.has(playlistSong.song.id),
        hasMedia: songAggregates.mediaSongIds.has(playlistSong.song.id),
        translationLanguages:
          songAggregates.translationLanguagesBySongId.get(
            playlistSong.song.id,
          ) ?? [],
      }),
    }));

  return {
    id: playlist.id,
    name: playlist.name,
    description: playlist.description,
    songCount: songs.length,
    songs,
    createdAt: playlist.createdAt.toISOString(),
    updatedAt: playlist.updatedAt.toISOString(),
  };
}
