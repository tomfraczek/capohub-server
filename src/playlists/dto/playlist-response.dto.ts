import { SongSummaryResponseDto } from '../../songs/dto/song-summary-response.dto';

export interface PlaylistSongItemDto {
  id: string;
  position: number;
  song: SongSummaryResponseDto;
}

export interface PlaylistResponseDto {
  id: string;
  name: string;
  description: string | null;
  songCount: number;
  songs: PlaylistSongItemDto[];
  createdAt: string;
  updatedAt: string;
}
