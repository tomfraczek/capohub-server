// Rhythm summary embedded in InstrumentDetailsResponseDto.rhythms - never
// the full Rhythm shape (spec section 7).
export interface InstrumentRhythmRefDto {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  roleDescription: string | null;
  displayOrder: number;
}
