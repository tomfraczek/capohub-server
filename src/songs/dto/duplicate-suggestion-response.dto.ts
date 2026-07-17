import { SongStatus } from '../enums/song-status.enum';

// Deliberately minimal - no lyrics, translations, phonetics, media,
// moderation notes or submitter identity (spec section 3/18). `similarity`
// is presentation-only: the frontend must not make the block/allow
// decision itself, only the backend's submit-time check does that.
export interface DuplicateSongSuggestionDto {
  id: string;
  title: string;
  firstLine: string | null;
  status: SongStatus;
  similarity: number;
}

export interface DuplicateSuggestionsResponseDto {
  items: DuplicateSongSuggestionDto[];
}
