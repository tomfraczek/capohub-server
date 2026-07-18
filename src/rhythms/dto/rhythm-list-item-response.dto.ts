import { RhythmMediaResponseDto } from './rhythm-media-response.dto';

export interface RhythmListItemResponseDto {
  id: string;
  slug: string;
  name: string;
  alternativeNames: string[];
  shortDescription: string | null;
  tempoDescription: string | null;
  tempoMinBpm: number | null;
  tempoMaxBpm: number | null;
  primaryMedia: RhythmMediaResponseDto | null;
}
