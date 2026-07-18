// Embedded in SongDetailsResponseDto.rhythms (spec section 9) - never the
// full Rhythm shape, and never an inactive rhythm.
export interface SongRhythmRefDto {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  isPrimary: boolean;
  description: string | null;
}
