import { SongSummaryResponseDto } from '../../songs/dto/song-summary-response.dto';

// Reuses the existing, already-lightweight SongSummaryResponseDto (spec
// section 8: "nie duplikuj ręcznie formatu piosenki") instead of hand-
// rolling a parallel song shape.
export interface RhythmSongRefDto extends SongSummaryResponseDto {
  isPrimary: boolean;
  relationDescription: string | null;
}
