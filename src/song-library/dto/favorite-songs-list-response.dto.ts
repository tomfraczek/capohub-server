import { SongSummaryResponseDto } from '../../songs/dto/song-summary-response.dto';

export interface FavoriteSongListItemDto extends SongSummaryResponseDto {
  favoritedAt: string;
}

export interface FavoriteSongsListResponseDto {
  items: FavoriteSongListItemDto[];
}
