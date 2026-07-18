import { MusicMediaType } from '../../common/enums/music-media-type.enum';

export interface InstrumentMediaResponseDto {
  id: string;
  type: MusicMediaType;
  url: string;
  title: string | null;
  description: string | null;
  displayOrder: number;
}
