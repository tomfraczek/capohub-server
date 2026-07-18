import { RhythmInstrumentRefDto } from './rhythm-instrument-ref.dto';
import { RhythmMediaResponseDto } from './rhythm-media-response.dto';
import { RhythmSongRefDto } from './rhythm-song-ref.dto';

// Shared by the public GET /rhythms/:slug and the admin
// GET/POST/PATCH /admin/rhythms endpoints.
export interface RhythmDetailsResponseDto {
  id: string;
  slug: string;
  name: string;
  alternativeNames: string[];
  shortDescription: string | null;
  description: string | null;
  history: string | null;
  usage: string | null;
  character: string | null;
  tempoDescription: string | null;
  tempoMinBpm: number | null;
  tempoMaxBpm: number | null;
  displayOrder: number;
  isActive: boolean;
  media: RhythmMediaResponseDto[];
  instruments: RhythmInstrumentRefDto[];
  songs: RhythmSongRefDto[];
  createdAt: string;
  updatedAt: string;
}
