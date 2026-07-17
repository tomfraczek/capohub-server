import { SongStatus } from '../enums/song-status.enum';
import { SongCategoryResponseDto } from './song-category-response.dto';
import { TagResponseDto } from './tag-response.dto';
import { SongUserRefDto } from './song-user-ref.dto';

export interface SongSummaryResponseDto {
  id: string;
  title: string;
  authorName: string | null;
  status: SongStatus;
  category: SongCategoryResponseDto;
  tags: TagResponseDto[];
  hasPhonetics: boolean;
  translationLanguages: string[];
  hasMedia: boolean;
  createdBy: SongUserRefDto | null;
  createdAt: string;
  updatedAt: string;
}
