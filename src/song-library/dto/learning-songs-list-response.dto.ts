import { SongSummaryResponseDto } from '../../songs/dto/song-summary-response.dto';
import { LearningStatus } from '../enums/learning-status.enum';

export interface LearningSongListItemDto extends SongSummaryResponseDto {
  learningStatus: LearningStatus;
}

export interface LearningSongsListResponseDto {
  items: LearningSongListItemDto[];
}
