import { SongMediaProvider } from '../enums/song-media-provider.enum';
import { SongUserRefDto } from './song-user-ref.dto';

// Standalone representation of a single SongMedia row, returned by the
// verify/unverify endpoints - unlike SongMediaResponseDto (song-details-
// response.dto.ts), which is only ever nested inside a SongDetailsResponse,
// this one carries its own songId and timestamps.
export interface SongMediaDetailsResponseDto {
  id: string;
  songId: string;
  provider: SongMediaProvider;
  url: string;
  title: string | null;
  position: number;
  isVerified: boolean;
  createdBy: SongUserRefDto | null;
  createdAt: string;
  updatedAt: string;
}
