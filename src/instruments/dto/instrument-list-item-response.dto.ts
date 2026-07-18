import { InstrumentMediaResponseDto } from './instrument-media-response.dto';

// Deliberately lightweight - no description/history/construction/etc. and no
// related-rhythms count/list (spec section 7: only include it "if the
// frontend actually needs it", and no confirmed screen needs it yet).
export interface InstrumentListItemResponseDto {
  id: string;
  slug: string;
  name: string;
  alternativeNames: string[];
  shortDescription: string | null;
  primaryMedia: InstrumentMediaResponseDto | null;
}
