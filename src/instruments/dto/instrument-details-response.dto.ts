import { InstrumentMediaResponseDto } from './instrument-media-response.dto';
import { InstrumentRhythmRefDto } from './instrument-rhythm-ref.dto';

// Shared by the public GET /instruments/:slug and the admin
// GET/POST/PATCH /admin/instruments endpoints - the admin variant simply
// isn't filtered by isActive before being mapped (see InstrumentsService).
export interface InstrumentDetailsResponseDto {
  id: string;
  slug: string;
  name: string;
  alternativeNames: string[];
  shortDescription: string | null;
  description: string | null;
  history: string | null;
  construction: string | null;
  howToPlay: string | null;
  roleInBateria: string | null;
  displayOrder: number;
  isActive: boolean;
  media: InstrumentMediaResponseDto[];
  rhythms: InstrumentRhythmRefDto[];
  createdAt: string;
  updatedAt: string;
}
