// Instrument summary embedded in RhythmDetailsResponseDto.instruments -
// never the full Instrument shape (spec section 8).
export interface RhythmInstrumentRefDto {
  id: string;
  slug: string;
  name: string;
  shortDescription: string | null;
  roleDescription: string | null;
  displayOrder: number;
}
